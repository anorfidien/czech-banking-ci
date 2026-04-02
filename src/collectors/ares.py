import json
import logging

from src.analysis.change_detector import detect_changes
from src.collectors.base import BaseCollector, CollectorError
from src.models import Signal

logger = logging.getLogger(__name__)

ARES_API_URL = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}"


class AresCollector(BaseCollector):
    name = "ares"
    rate_limit_delay = 3.0
    required_source_key = "ares_ico"

    def collect(self, competitor_id: str) -> list[Signal]:
        config = self._load_competitor_config(competitor_id)
        ico = config["sources"]["ares_ico"]
        signals = []

        signals.extend(self._collect_ares_api(competitor_id, ico))
        # Justice.cz disabled — fragile HTML parsing, low signal value

        return signals

    # ── ARES REST API ────────────────────────────────────────────

    def _collect_ares_api(self, competitor_id: str, ico: str) -> list[Signal]:
        url = ARES_API_URL.format(ico=ico)
        snapshot_key = f"ares_api:{ico}"

        try:
            content, has_changed = self._fetch_and_store_snapshot(
                competitor_id, snapshot_key, url,
                headers={"Accept": "application/json"},
            )
        except CollectorError:
            logger.warning("ARES API unreachable for ICO %s", ico)
            return []

        if not has_changed:
            logger.info("No ARES changes for %s", competitor_id)
            return []

        data = json.loads(content)
        prev = self.db.get_previous_snapshot(competitor_id, self.name, snapshot_key)

        if prev is None:
            return [Signal(
                competitor_id=competitor_id,
                source=self.name,
                signal_type="baseline",
                title=f"ARES baseline captured for {data.get('obchodniJmeno', ico)}",
                content=f"Company: {data.get('obchodniJmeno')}, ICO: {ico}",
                url=url,
                severity=3,
                tags=["baseline", "ares"],
                metadata={"ico": ico, "name": data.get("obchodniJmeno"), "priority_reason": "Low: initial baseline capture"},
            )]

        changes = detect_changes(prev["content"], content, "json")

        if not changes.has_meaningful_changes:
            return []

        signals = []
        for change in changes.changes:
            signal_type, severity, reason = self._classify_ares_change(change.path)
            signals.append(Signal(
                competitor_id=competitor_id,
                source=self.name,
                signal_type=signal_type,
                title=f"ARES change: {change.path}",
                content=changes.summary,
                url=url,
                severity=severity,
                tags=["ares", signal_type],
                metadata={"field": change.path, "old": change.old_value, "new": change.new_value, "priority_reason": reason},
                change_summary=f"{change.path}: {change.old_value} → {change.new_value}",
            ))
        return signals

    def _classify_ares_change(self, path: str) -> tuple[str, int, str]:
        """Returns (signal_type, severity, reason). 1=High, 2=Medium, 3=Low."""
        path_lower = path.lower()
        if "obchodniJmeno" in path_lower or "nazev" in path_lower:
            return "name_change", 1, "High: company name change"
        if "statutarni" in path_lower or "organ" in path_lower:
            return "board_change", 1, "High: board/statutory body change"
        if "kapital" in path_lower or "zakladni" in path_lower:
            return "capital_change", 1, "High: share capital change"
        if "nace" in path_lower or "cinnost" in path_lower:
            return "nace_change", 2, "Medium: business activity (NACE) change"
        if "registrac" in path_lower or "rejstrik" in path_lower:
            return "registration_change", 2, "Medium: registry change"
        if "sidlo" in path_lower:
            return "address_change", 3, "Low: registered address change"
        return "ares_change", 3, "Low: minor ARES field change"

