import logging
from pathlib import Path

import feedparser
import yaml
from bs4 import BeautifulSoup
from dateutil.parser import parse as parse_date

from src.collectors.base import BaseCollector, CollectorError
from src.models import Signal

logger = logging.getLogger(__name__)

HIGH_KEYWORDS = {
    "akvizice", "acquisition", "fúze", "merger", "regulat",
    "pokuta", "fine", "penalty", "sankce", "licence",
    "ipo", "transformace", "restrukturalizace", "restructur",
    "ceo", "ředitel", "jmenování", "odvolání", "resignation",
    "čnb", "cnb", "úroková sazba", "interest rate",
}
MEDIUM_KEYWORDS = {
    "nový produkt", "new product", "spouští", "launch",
    "partnerství", "partnership", "spolupráce", "cooperation",
    "investice", "investment", "expanze", "expansion",
    "digitální", "digital", "inovace", "innovation",
    "hypotéka", "mortgage", "úvěr", "kredit",
}
CATEGORY_MAP = {
    "regulation": ["regulat", "pokuta", "fine", "sankce", "licence", "čnb", "cnb", "dohled"],
    "m&a": ["akvizice", "fúze", "merger", "acquisition"],
    "leadership": ["ceo", "ředitel", "jmenování", "odvolání", "board", "představenstvo"],
    "product": ["nový produkt", "spouští", "launch", "aplikace", "app", "mobilní"],
    "partnership": ["partnerství", "partnership", "spolupráce"],
    "financial": ["zisk", "profit", "ztráta", "loss", "výsledky", "results", "tržby", "revenue"],
    "rates": ["úroková sazba", "interest rate", "sazby", "hypotéka", "mortgage"],
}


class NewsCollector(BaseCollector):
    name = "news"
    rate_limit_delay = 1.0
    # No required_source_key — this collector always runs (industry feeds apply to all)
    required_source_key = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._industry_feeds: list[dict] | None = None
        self._alias_map: dict[str, list[str]] | None = None

    def _load_industry_feeds(self) -> list[dict]:
        if self._industry_feeds is not None:
            return self._industry_feeds
        sources_path = self.config_dir / "sources.yaml"
        if not sources_path.exists():
            logger.warning("No sources.yaml found at %s", sources_path)
            self._industry_feeds = []
            return self._industry_feeds
        data = yaml.safe_load(sources_path.read_text(encoding="utf-8"))
        self._industry_feeds = data.get("industry_feeds", [])
        logger.info("Loaded %d industry feeds", len(self._industry_feeds))
        return self._industry_feeds

    def _load_alias_map(self) -> dict[str, list[str]]:
        """Build a map of competitor_id -> list of lowercase aliases."""
        if self._alias_map is not None:
            return self._alias_map
        self._alias_map = {}
        competitors = self.db.get_competitors()
        for comp in competitors:
            config = self._load_competitor_config(comp["id"])
            aliases = config.get("aliases", [])
            # Always include the name itself
            all_names = set(a.lower() for a in aliases)
            all_names.add(comp["name"].lower())
            self._alias_map[comp["id"]] = list(all_names)
        return self._alias_map

    def _match_competitors(self, text: str) -> list[str]:
        """Find which competitors are mentioned in text."""
        text_lower = text.lower()
        alias_map = self._load_alias_map()
        matched = []
        for comp_id, aliases in alias_map.items():
            for alias in aliases:
                if alias in text_lower:
                    matched.append(comp_id)
                    break
        return matched

    def collect(self, competitor_id: str) -> list[Signal]:
        config = self._load_competitor_config(competitor_id)
        signals = []

        # 1. Scan industry feeds (ČNB, HN, E15, Kurzy, Měšec, Patria, Roklen24, ČTK)
        for feed in self._load_industry_feeds():
            feed_signals = self._collect_feed(
                competitor_id=None,
                rss_url=feed["url"],
                feed_name=feed["name"],
                feed_category=feed.get("category", ""),
                feed_priority=feed.get("priority", "medium"),
            )
            for sig in feed_signals:
                text = f"{sig.title} {sig.content}"
                if competitor_id in self._match_competitors(text):
                    sig.competitor_id = competitor_id
                    signals.append(sig)

        # 2. Scrape bank's own press page if configured
        press_url = config.get("sources", {}).get("press_url")
        if press_url:
            signals.extend(self._scrape_press_page(competitor_id, press_url, config["name"]))

        return signals

    def _scrape_press_page(self, competitor_id: str, url: str, bank_name: str) -> list[Signal]:
        """Scrape press releases from a bank's own press/news page."""
        try:
            resp = self._fetch(url)
        except CollectorError:
            logger.warning("Failed to fetch press page: %s", url)
            return []

        soup = BeautifulSoup(resp.text, "lxml")
        # Remove navigation chrome
        for tag in soup(["nav", "footer", "header", "script", "style", "noscript"]):
            tag.decompose()

        signals = []
        seen = set()

        # Find article-like links: <a> with substantial text inside h2/h3/h4/h5/h6 or with long text
        for a in soup.select("a[href]"):
            text = a.get_text(strip=True)
            href = a.get("href", "")

            if not text or len(text) < 20 or len(text) > 250:
                continue
            if not href or href.startswith("#") or href.startswith("javascript"):
                continue

            # Must look like an article link (not navigation)
            parent_tag = a.parent.name if a.parent else ""
            is_heading = parent_tag in ("h1", "h2", "h3", "h4", "h5", "h6")
            has_press_kw = any(kw in href.lower() for kw in [
                "zprav", "press", "news", "blog", "clanek", "article",
                "2024", "2025", "2026", "detail", "post",
            ])

            if not is_heading and not has_press_kw:
                continue

            # Normalize URL
            if href.startswith("/"):
                from urllib.parse import urlparse
                parsed = urlparse(url)
                href = f"{parsed.scheme}://{parsed.netloc}{href}"

            # Dedup by title
            title_key = text.lower().strip()
            if title_key in seen:
                continue
            seen.add(title_key)

            score, tags, reason = self._analyze_article(text, "")
            tags.append(f"src:press:{bank_name}")

            signals.append(Signal(
                competitor_id=competitor_id,
                source=self.name,
                signal_type="press_release",
                title=text,
                content=f"Press release from {bank_name}",
                url=href,
                severity=score,
                tags=tags,
                metadata={
                    "feed_name": f"press:{bank_name}",
                    "feed_url": url,
                    "feed_category": "press",
                    "priority_reason": reason,
                },
            ))

        logger.info("Found %d press releases from %s", len(signals), bank_name)
        return signals

    def _collect_feed(
        self,
        competitor_id: str | None,
        rss_url: str,
        feed_name: str,
        feed_category: str = "",
        feed_priority: str = "medium",
    ) -> list[Signal]:
        signals = []

        try:
            resp = self._fetch(rss_url)
        except CollectorError:
            logger.warning("Failed to fetch RSS: %s (%s)", feed_name, rss_url)
            return []

        feed = feedparser.parse(resp.text)

        for entry in feed.entries:
            title = entry.get("title", "").strip()
            link = entry.get("link", "")
            published = entry.get("published", "")
            summary = entry.get("summary", "")

            if not title:
                continue

            if summary:
                summary = BeautifulSoup(summary, "lxml").get_text(strip=True)

            published_at = None
            if published:
                try:
                    published_at = parse_date(published).isoformat()
                except (ValueError, TypeError):
                    pass

            score, tags, reason = self._analyze_article(title, summary)

            # Boost score for critical/high-priority feeds (lower number = higher priority)
            if feed_priority == "critical" and score > 1:
                score = max(score - 1, 1)
                reason = f"{reason}; boosted by {feed_name} (critical source)"

            # Add feed source tag
            if feed_category:
                tags.append(f"feed:{feed_category}")
            tags.append(f"src:{feed_name}")

            signal = Signal(
                competitor_id=competitor_id or "__unmatched__",
                source=self.name,
                signal_type="news_article",
                title=title,
                content=summary[:1000] if summary else title,
                url=link,
                published_at=published_at,
                severity=score,
                tags=tags,
                metadata={
                    "feed_name": feed_name,
                    "feed_url": rss_url,
                    "feed_category": feed_category,
                    "published_raw": published,
                    "priority_reason": reason,
                },
            )
            signals.append(signal)

        logger.info("Found %d articles from %s", len(signals), feed_name)
        return signals

    def _analyze_article(self, title: str, summary: str) -> tuple[int, list[str], str]:
        text = f"{title} {summary}".lower()
        tags = ["news"]

        high_hits = [kw for kw in HIGH_KEYWORDS if kw in text]
        med_hits = [kw for kw in MEDIUM_KEYWORDS if kw in text]

        if high_hits:
            score = 1
            reason = f"High: matched [{', '.join(high_hits)}]"
        elif med_hits:
            score = 2
            reason = f"Medium: matched [{', '.join(med_hits)}]"
        else:
            score = 3
            reason = "Low: no priority keywords matched"

        for category, keywords in CATEGORY_MAP.items():
            if any(kw in text for kw in keywords):
                tags.append(category)

        return score, tags, reason
