# Czech Banking Competitive Intelligence Monitor — Project Spec

## Overview

Build a competitive intelligence monitoring system for the Czech banking sector. The system scrapes publicly available data sources, detects changes and anomalies, scores competitive threats, and produces actionable intelligence reports. The core philosophy is **asymmetric intelligence** — extracting better signals from sources that competitors overlook.

### Core Purpose
Maintain continuous market awareness across the entire Czech banking sector — so nothing moves without us knowing. No competitor launches a product, changes a price, shifts strategy, or makes a regulatory move that we don't catch.

The system achieves this through two primary mechanisms:
1. **Change monitoring** — detect any change on competitor websites (pricing, careers, filings, product pages) by diffing against the previous scrape. Every change is a signal.
2. **News monitoring** — continuously aggregate press releases and news mentions per competitor, processed into a single unified feed.

Everything else (scoring, correlation, threat models, trademark monitoring) extends and enriches these two functions. The goal is a single source of truth: one place where the full competitive picture is always current, always complete.

## Target Competitors

### Tier 1 — Universal Banks (monitor everything)
- **Česká spořitelna** (Erste Group) — csas.cz
- **ČSOB** (KBC Group) — csob.cz  
- **Komerční banka** (Société Générale) — kb.cz

### Tier 2 — Challengers (monitor selectively)
- **Raiffeisenbank** (RBI) — rb.cz
- **Air Bank** (PPF Group) — airbank.cz
- **Moneta Money Bank** — moneta.cz
- **Fio banka** — fio.cz
- **mBank** (Commerzbank) — mbank.cz
- **UniCredit Bank** — unicreditbank.cz

### Tier 3 — Fintechs (monitor product & growth signals)
- **Revolut CZ** — revolut.com
- **Partners Bank** — partnersbank.cz

---

## Architecture

### Tech Stack (MVP)
- **Language:** Python 3.11+
- **Database:** SQLite for MVP (migrate to PostgreSQL later)
- **Scraping:** httpx + BeautifulSoup (simple), Playwright (JS-rendered pages)
- **NLP:** Basic sentiment via TextBlob or a Czech-language model
- **Scheduling:** APScheduler or cron
- **Alerts:** Telegram Bot API (primary), email (secondary)
- **Dashboard:** Streamlit (MVP) or React (later)
- **Config:** YAML-based, one file per competitor

### Project Structure
```
czech-banking-ci/
├── README.md
├── pyproject.toml              # Dependencies, project metadata
├── config/
│   ├── settings.yaml           # Global settings (DB path, alert config, API keys)
│   ├── competitors/            # One YAML per competitor
│   │   ├── ceska_sporitelna.yaml
│   │   ├── csob.yaml
│   │   ├── komercni_banka.yaml
│   │   ├── air_bank.yaml
│   │   └── ...
│   └── sources.yaml            # Source definitions & scrape schedules
├── src/
│   ├── __init__.py
│   ├── models/
│   │   ├── __init__.py
│   │   ├── database.py         # SQLite/PostgreSQL setup, session management
│   │   ├── competitor.py       # Competitor model
│   │   ├── signal.py           # Signal model (the core data unit)
│   │   └── report.py           # Report model
│   ├── collectors/
│   │   ├── __init__.py
│   │   ├── base.py             # Abstract collector class
│   │   ├── justice_cz.py       # Justice.cz / ARES API collector
│   │   ├── cnb.py              # Czech National Bank filings
│   │   ├── job_postings.py     # Career pages + job board scraper
│   │   ├── app_store.py        # Google Play & App Store metadata
│   │   ├── pricing.py          # Bank tariff/pricing page monitor
│   │   ├── linkedin.py         # LinkedIn org changes (manual/RSS)
│   │   ├── trademark.py        # ÚPVZ/EUIPO trademark filings
│   │   └── news.py             # Press releases & news mentions
│   ├── analysis/
│   │   ├── __init__.py
│   │   ├── change_detector.py  # Diff engine for detecting changes
│   │   ├── signal_scorer.py    # Score signals by importance
│   │   ├── correlator.py       # Cross-signal correlation engine
│   │   └── threat_model.py     # Competitive threat scoring
│   ├── alerts/
│   │   ├── __init__.py
│   │   ├── telegram.py         # Telegram bot integration
│   │   └── email.py            # Email alerts
│   ├── reports/
│   │   ├── __init__.py
│   │   ├── weekly_pulse.py     # Weekly summary generator
│   │   └── strategic.py        # Quarterly strategic analysis
│   └── dashboard/
│       ├── __init__.py
│       └── app.py              # Streamlit dashboard
├── scripts/
│   ├── run_collectors.py       # Run all collectors once
│   ├── run_analysis.py         # Run analysis pipeline
│   └── setup_db.py             # Initialize database
├── tests/
│   ├── test_collectors/
│   ├── test_analysis/
│   └── fixtures/               # Sample HTML, JSON for testing
└── data/
    ├── db/                     # SQLite database files
    └── archive/                # Raw scraped data archive
```

---

## Data Model

### Signal (core unit)
Every piece of intelligence is a **Signal**:

```python
class Signal:
    id: str                    # UUID
    competitor_id: str         # Which bank
    source: str                # Which collector produced this
    signal_type: str           # "job_posting", "filing", "pricing_change", etc.
    title: str                 # Human-readable title
    content: str               # Full content/description
    url: str                   # Source URL
    detected_at: datetime      # When we found it
    published_at: datetime     # When it was actually published (if known)
    severity: int              # 1-5 scale
    tags: list[str]            # Auto-generated tags
    metadata: dict             # Source-specific structured data
    is_new: bool               # First time seen?
    change_summary: str        # If update to existing signal, what changed?
```

### Competitor Config (YAML) — Pluggable Sources
Sources are **opt-in per competitor**. A collector only runs for a competitor if the relevant source key exists in their config. Not every competitor is on ARES (e.g., Revolut is foreign-registered), not every competitor has a jobs.cz presence. Sources can be added or removed at any time by editing the YAML — no code changes needed.

```yaml
# config/competitors/ceska_sporitelna.yaml — Czech bank, all sources
id: ceska_sporitelna
name: "Česká spořitelna"
parent_group: "Erste Group"
tier: 1

sources:
  ares_ico: "45244782"                # ARES/Justice.cz — only if Czech IČO exists
  careers_url: "https://www.csas.cz/cs/karierni-prilezitosti"
  careers_search_name: "Česká spořitelna"
  pricing_url: "https://www.csas.cz/cs/osobni-finance/sazebnik"
  website_urls:                        # generic page monitoring
    - "https://www.csas.cz/cs/osobni-finance"
  app_google_play: "cz.csas.app"
  app_apple: "id123456789"
  news_search_name: "Česká spořitelna"

monitoring:
  priority: high
```

```yaml
# config/competitors/revolut_cz.yaml — foreign fintech, NO ARES, monitor their site
id: revolut_cz
name: "Revolut"
parent_group: "Revolut Ltd"
tier: 3

sources:
  website_urls:                        # monitor product/pricing pages directly
    - "https://www.revolut.com/cs-CZ/"
    - "https://www.revolut.com/cs-CZ/pricing/"
  news_search_name: "Revolut Česko"
  app_google_play: "com.revolut.revolut"

monitoring:
  priority: medium
```

### Data Export
All collected signals are exportable to **XLSM (Excel with macros)** at any time via CLI. The export includes:
- **Signals sheet** — all signals with full metadata, filterable by competitor/source/severity/date
- **Competitors sheet** — competitor list with configured sources
- **Pivot-ready** — columns structured for Excel pivot tables and slicers
```

---

## Collector Specifications

### 1. Justice.cz / ARES Collector (`justice_cz.py`)
**Asymmetry: Very High** — Almost nobody monitors this systematically.

- Use the ARES API (https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/) to pull company data by IČO
- Monitor for: changes in statutory bodies (board members), new subsidiaries, address changes, annual report filings
- Store historical snapshots to detect changes via diff
- Check weekly

### 2. ČNB Collector (`cnb.py`)
**Asymmetry: High**

- Scrape the ČNB website for: regulated entity listings, supervisory decisions, license applications
- Key URL patterns: https://apl.cnb.cz/apljerrsdad/JERRS.WEB07.INTRO_PAGE
- Parse PDF reports when available
- Check weekly

### 3. Job Postings Collector (`job_postings.py`)
**Asymmetry: High** — Reveals strategic intent 6-12 months ahead.

- Scrape bank career pages (URLs in competitor config)
- Also check: jobs.cz, startupjobs.cz, LinkedIn (if API available)
- Key signals: roles mentioning crypto, AI/ML, open banking, specific technologies
- Track: role title, department, seniority, tech stack mentioned, location
- Detect patterns: hiring spikes in specific areas = strategic bet
- Check daily

### 4. App Store Collector (`app_store.py`)
**Asymmetry: Medium**

- Google Play: scrape app detail page for version history, rating, review count
- App Store: similar via iTunes Lookup API
- Track: version numbers, release dates, what's new text, rating trends
- Detect: major version jumps, feature keywords, rating drops
- Check daily

### 5. Pricing Collector (`pricing.py`)
**Asymmetry: Medium**

- Scrape bank fee schedule / sazebník pages
- Store full page content, run diff to detect changes
- Key signals: fee reductions (competitive pressure), new product pricing, free tier changes
- Check daily

### 6. Trademark Collector (`trademark.py`)
**Asymmetry: Very High** — Nobody checks this.

- Query TMView or ÚPVZ for new trademark applications from known bank entities
- New trademarks = upcoming product brand names
- Check monthly

### 7. News & PR Collector (`news.py`)
**Asymmetry: Low** — Everyone monitors this, but still necessary.

- Monitor bank press release pages / tiskové zprávy
- Aggregate via Google News RSS for each bank name
- Basic sentiment analysis
- Check daily

---

## Analysis Engine

### Change Detection (`change_detector.py`)
- Compare current scrape output with previous stored version
- Use difflib for text comparison
- Classify changes: new_item, modified_item, removed_item
- Filter out noise (boilerplate changes, timestamp updates)

### Signal Scoring (`signal_scorer.py`)
Score each signal 1-5 based on:
- **Source asymmetry weight** (justice.cz filing = 5, press release = 2)
- **Content keywords** (crypto, AI, acquisition, partnership = boost)
- **Seniority** (C-suite job posting = 5, junior = 1)
- **Novelty** (first occurrence = boost)
- **Cross-signal correlation** (matches pattern = boost)

### Correlation Engine (`correlator.py`)
Look for known patterns that indicate strategic moves:

| Pattern | Signals | Inference |
|---------|---------|-----------|
| Product Launch | Job postings + trademark + app update | New product in 3-6 months |
| Restructuring | Executive changes + bad reviews + hiring freeze | Internal turmoil |
| Market Expansion | ČNB license + new subsidiary + API changes | New service category |
| Pricing War | Fee reductions + marketing jobs + PR push | Customer acquisition push |
| Platform Migration | DevOps hiring + vendor tender + API deprecation | Core system overhaul |

### Threat Model (`threat_model.py`)
Maintain a running threat score per competitor based on:
- Accumulated signal severity
- Rate of change (acceleration = higher threat)
- Strategic alignment (are they moving into our space?)
- Resource commitment (hiring volume, capex signals)

---

## Alert System

### Telegram Bot (`telegram.py`)
- Use python-telegram-bot library
- Send formatted messages with signal details
- Three channels: #ci-alerts (high severity), #ci-weekly (pulse), #ci-strategic (quarterly)
- Include direct links to sources

### Alert Triggers
- Severity 4-5 signals → immediate Telegram alert
- Correlation pattern detected → immediate alert with inference
- Weekly digest → scheduled Monday 08:00 CET

---

## Reports

### Weekly Pulse (`weekly_pulse.py`)
Auto-generated every Monday:
1. Executive summary (top 3 signals this week)
2. Signal count by competitor and source
3. New signals listed by severity
4. Trend indicators (what's accelerating)
5. Action items (what requires human review)

Format: Markdown file, also sent via Telegram

### Strategic Analysis (`strategic.py`)
Quarterly template (human-assisted):
1. Per-competitor strategy assessment
2. Threat matrix update
3. Opportunity identification
4. Asymmetry audit (what signals are WE leaking?)

---

## Dashboard (Streamlit MVP)

Tabs:
1. **Live Feed** — Real-time signal stream, filterable by competitor/source/severity
2. **Threat Map** — Competitor threat scores with trend arrows
3. **Source Status** — Health of each collector (last run, success rate, signal count)
4. **Reports** — Generated weekly pulses and strategic briefs
5. **Search** — Full-text search across all signals

---

## Implementation Priority

### Phase 1 (Week 1-2): Foundation
- [ ] Project setup, database schema, models
- [ ] Base collector class with retry logic, rate limiting, error handling
- [ ] Justice.cz/ARES collector (highest asymmetry)
- [ ] Job postings collector (highest strategic value)
- [ ] Basic change detection
- [ ] Simple CLI to run collectors and view results

### Phase 2 (Week 3-4): Core Pipeline
- [ ] App store collector
- [ ] Pricing collector
- [ ] News collector
- [ ] Signal scoring engine
- [ ] Telegram alert integration
- [ ] Scheduled runs via APScheduler

### Phase 3 (Week 5-6): Intelligence Layer
- [ ] Correlation engine
- [ ] Threat model
- [ ] Weekly pulse report generator
- [ ] Streamlit dashboard (basic)

### Phase 4 (Week 7-8): Polish
- [ ] Trademark collector
- [ ] ČNB collector
- [ ] Dashboard improvements
- [ ] Tests
- [ ] Docker setup for deployment
- [ ] Documentation

---

## Key Design Principles

1. **Fail gracefully** — If a scraper breaks, log it and continue. Never crash the pipeline.
2. **Store raw data** — Always archive the raw HTML/JSON before processing. You'll want to re-parse later.
3. **Idempotent runs** — Running a collector twice should not create duplicate signals.
4. **Respect rate limits** — Add delays between requests. Use rotating user agents. Don't get blocked.
5. **Human in the loop** — The system surfaces signals; humans make strategic decisions.
6. **OPSEC awareness** — Don't expose your monitoring infrastructure. Use proxies if needed.

---

## Getting Started with Claude Code

Paste this spec into Claude Code and start with:

```
Build Phase 1 of this CI monitor. Start with the project setup, database models, 
and the ARES/Justice.cz collector. Make it runnable with a simple CLI command.
```

Then iterate phase by phase. Claude Code can test the scrapers against real URLs, 
debug parsing issues, and build out the pipeline incrementally.
