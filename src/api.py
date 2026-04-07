"""Flask API server for the CI Monitor dashboard."""

import json
import logging
import os
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from src.models.database import Database

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent
DASHBOARD_DIST = PROJECT_ROOT / "dashboard" / "dist"

# ── Signal segment classifier ───────────────────────────────
SEGMENT_KEYWORDS = {
    "retail": [
        "retail", "hypotéka", "hypoteční", "mortgage", "spotřebitel", "consumer",
        "osobní", "personal", "klient", "karta", "card", "účet", "account",
        "mobilní bankovnictví", "mobile banking", "spoření", "savings",
        "pojištění", "insurance", "penzijní", "pension", "půjčka", "loan",
        "úvěr", "credit", "nps", "digital", "aplikace", "app",
        "pobočka", "branch", "bankomat", "atm", "investiční produkt",
        "dlouhodobý investiční", "dip",
    ],
    "corporate": [
        "corporate", "korporátní", "firemní", "enterprise", "trade finance",
        "syndikace", "syndication", "projektové financování", "project finance",
        "investiční bankovnictví", "investment banking", "emise", "bond",
        "akvizice", "acquisition", "fúze", "merger", "m&a", "ipo",
        "capital markets", "kapitálový trh", "treasury",
        "sídlo", "headquarters", "přesun", "vedení", "představenstvo", "board",
        "výroční zpráva", "annual report", "výroční finanční",
        "ppf", "group", "holding",
    ],
    "sme": [
        "sme", "msp", "malé podniky", "střední podniky", "small business",
        "podnikatel", "živnostník", "entrepreneur", "freelance",
        "firemní účet", "business account", "leasing", "faktoring", "factoring",
        "provozní úvěr", "working capital",
    ],
    "regulatory": [
        "baseline", "ares", "justice", "čnb", "cnb", "regulat",
        "licence", "dohled", "supervision", "liquidity", "monetary policy",
        "pokuta", "sankce",
    ],
}


def _classify_segment(title: str, content: str, tags: list) -> str:
    """Classify a signal into retail/corporate/sme/general."""
    text = f"{title} {content} {' '.join(tags)}".lower()
    scores = {}
    for segment, keywords in SEGMENT_KEYWORDS.items():
        scores[segment] = sum(1 for kw in keywords if kw in text)
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "general"


def create_app(db_path: str | None = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    CORS(app)

    if db_path is None:
        db_path = str(PROJECT_ROOT / "data" / "db" / "ci_monitor.sqlite")

    def get_db() -> Database:
        return Database(db_path)

    # ── API Routes ───────────────────────────────────────────

    @app.route("/api/signals")
    def api_signals():
        db = get_db()
        try:
            signals = db.get_signals(
                competitor_id=request.args.get("competitor"),
                source=request.args.get("source"),
                min_severity=_int_or_none(request.args.get("severity")),
                since=request.args.get("since"),
                limit=int(request.args.get("limit", 200)),
            )
            # Parse JSON fields + classify segment
            segment_filter = request.args.get("segment")
            result = []
            for sig in signals:
                sig["tags"] = _parse_json_field(sig.get("tags", "[]"))
                sig["metadata"] = _parse_json_field(sig.get("metadata", "{}"))
                sig["segment"] = _classify_segment(sig["title"], sig.get("content", ""), sig["tags"])
                if segment_filter and sig["segment"] != segment_filter:
                    continue
                result.append(sig)
            return jsonify(result)
        finally:
            db.close()

    @app.route("/api/competitors")
    def api_competitors():
        db = get_db()
        try:
            competitors = db.get_competitors()
            # Enrich with signal counts
            for comp in competitors:
                row = db.conn.execute(
                    "SELECT COUNT(*) as cnt, ROUND(AVG(severity),1) as avg_sev FROM signals WHERE competitor_id = ?",
                    (comp["id"],),
                ).fetchone()
                comp["signal_count"] = row["cnt"] if row else 0
                comp["avg_severity"] = row["avg_sev"] if row else 0
            return jsonify(competitors)
        finally:
            db.close()

    @app.route("/api/status")
    def api_status():
        db = get_db()
        try:
            runs = db.get_collector_status()
            return jsonify(runs)
        finally:
            db.close()

    @app.route("/api/summary")
    def api_summary():
        db = get_db()
        try:
            # Overall stats
            stats = db.conn.execute("""
                SELECT
                    COUNT(*) as total_signals,
                    ROUND(AVG(severity), 1) as avg_severity,
                    MAX(detected_at) as last_signal,
                    COUNT(DISTINCT competitor_id) as competitors_with_signals,
                    COUNT(DISTINCT source) as sources_active
                FROM signals
            """).fetchone()

            # Severity distribution
            severity_dist = db.conn.execute("""
                SELECT severity, COUNT(*) as count
                FROM signals GROUP BY severity ORDER BY severity
            """).fetchall()

            # Signals by source
            by_source = db.conn.execute("""
                SELECT source, COUNT(*) as count
                FROM signals GROUP BY source ORDER BY count DESC
            """).fetchall()

            # Signals by competitor (top 10)
            by_competitor = db.conn.execute("""
                SELECT competitor_id, COUNT(*) as count, ROUND(AVG(severity),1) as avg_severity
                FROM signals GROUP BY competitor_id ORDER BY count DESC LIMIT 10
            """).fetchall()

            # Recent signals (last 15)
            recent = db.get_signals(limit=15)
            for sig in recent:
                sig["tags"] = _parse_json_field(sig.get("tags", "[]"))
                sig["segment"] = _classify_segment(sig["title"], sig.get("content", ""), sig["tags"])

            # Signal volume by day (last 30 days)
            timeline = db.conn.execute("""
                SELECT DATE(detected_at) as date, COUNT(*) as count
                FROM signals
                WHERE detected_at >= DATE('now', '-30 days')
                GROUP BY DATE(detected_at)
                ORDER BY date
            """).fetchall()

            return jsonify({
                "total_signals": dict(stats) if stats else {},
                "severity_distribution": [dict(r) for r in severity_dist],
                "by_source": [dict(r) for r in by_source],
                "by_competitor": [dict(r) for r in by_competitor],
                "recent_signals": recent,
                "timeline": [dict(r) for r in timeline],
            })
        finally:
            db.close()

    @app.route("/api/metrics")
    def api_metrics():
        db = get_db()
        try:
            metrics = db.get_metrics(
                series_id=request.args.get("series_id"),
                category=request.args.get("category"),
                competitor_id=request.args.get("competitor"),
                since=request.args.get("since"),
                until=request.args.get("until"),
            )
            return jsonify(metrics)
        finally:
            db.close()

    @app.route("/api/metrics/series")
    def api_metrics_series():
        db = get_db()
        try:
            return jsonify(db.get_available_series())
        finally:
            db.close()

    # ── Drill-down definitions ─────────────────────────────────
    # parent_series_id -> list of (child_series_id, display_label)
    DRILLDOWNS = {
        "loans_total": {
            "custom": "loans",  # handled separately — mortgages is subset of retail
        },
        # op_income_ytd and op_expense_ytd drill-downs removed
        # — children don't add up to parent (different accounting scope)
        "total_assets": {
            "children": [
                ("loans_to_customers", "Loans to Customers"),
                ("loans_to_banks", "Loans to Banks"),
                ("debt_securities", "Debt Securities"),
                ("intangible_assets", "Intangible Assets"),
            ],
            "compute_other": True,
        },
        "total_liabilities": {
            "children": [
                ("customer_deposits", "Customer Deposits"),
                ("deposits_from_banks", "Deposits from Banks"),
            ],
            "compute_other": True,
        },
        # nii_ytd drill-down removed — Interest Income/Expense are gross
        # figures that don't net to NII (different scope)
    }

    @app.route("/api/metrics/drilldown")
    def api_metrics_drilldown():
        """Generic drill-down: break a parent metric into its children."""
        db = get_db()
        try:
            comp = request.args.get("competitor")
            parent = request.args.get("parent", "loans_total")
            if not comp or parent not in DRILLDOWNS:
                return jsonify([])

            config = DRILLDOWNS[parent]

            # Custom loans drill-down: Mortgages + Other Retail + Commercial + Other
            if config.get("custom") == "loans":
                result = _build_loans_drilldown(db, comp)
                return jsonify(result)

            result = []
            child_sums: dict[str, float] = {}

            for child_id, label in config["children"]:
                rows = db.get_metrics(series_id=child_id, competitor_id=comp)
                for r in rows:
                    result.append({**r, "series_name": label, "series_id": child_id})
                    child_sums[r["date"]] = child_sums.get(r["date"], 0) + r["value"]

            if config.get("compute_other"):
                parent_rows = db.get_metrics(series_id=parent, competitor_id=comp)
                for r in parent_rows:
                    other = r["value"] - child_sums.get(r["date"], 0)
                    if abs(other) > 0.5:
                        result.append({
                            "series_id": "other",
                            "series_name": "Other",
                            "date": r["date"],
                            "value": other,
                            "unit": r.get("unit", "mio CZK"),
                            "competitor_id": comp,
                        })

            return jsonify(sorted(result, key=lambda x: (x["date"], x["series_name"])))
        finally:
            db.close()

    @app.route("/api/metrics/drilldowns")
    def api_drilldown_config():
        """Return which metrics support drill-down."""
        result = {}
        for k, v in DRILLDOWNS.items():
            if v.get("custom") == "loans":
                result[k] = ["Mortgages", "Other Retail", "Commercial", "Other"]
            else:
                result[k] = [c[1] for c in v["children"]]
        return jsonify(result)

    # ── Static file serving (production) ─────────────────────

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_dashboard(path):
        if DASHBOARD_DIST.exists():
            file_path = DASHBOARD_DIST / path
            if file_path.is_file():
                return send_from_directory(str(DASHBOARD_DIST), path)
            return send_from_directory(str(DASHBOARD_DIST), "index.html")
        return jsonify({"error": "Dashboard not built. Run: cd dashboard && npm run build"}), 404

    return app


def _build_loans_drilldown(db: Database, comp: str) -> list[dict]:
    """Build loans drill-down: Mortgages, Other Retail, Commercial, Other.

    Mortgages is a subset of Retail, so:
    - Mortgages (from mortgages series)
    - Other Retail = Retail - Mortgages
    - Commercial (from loans_commercial series)
    - Other = Total - Retail - Commercial
    """
    total = {r["date"]: r["value"] for r in db.get_metrics(series_id="loans_total", competitor_id=comp)}
    retail = {r["date"]: r["value"] for r in db.get_metrics(series_id="loans_retail", competitor_id=comp)}
    commercial = {r["date"]: r["value"] for r in db.get_metrics(series_id="loans_commercial", competitor_id=comp)}
    mortgages = {r["date"]: r["value"] for r in db.get_metrics(series_id="mortgages", competitor_id=comp)}

    result = []
    for date in sorted(total.keys()):
        t = total.get(date, 0)
        r = retail.get(date, 0)
        c = commercial.get(date, 0)
        m = mortgages.get(date, 0)

        result.append({"series_id": "mortgages", "series_name": "Mortgages", "date": date, "value": m, "unit": "mio CZK", "competitor_id": comp})
        other_retail = r - m
        if other_retail > 0.5:
            result.append({"series_id": "other_retail", "series_name": "Other Retail", "date": date, "value": other_retail, "unit": "mio CZK", "competitor_id": comp})
        result.append({"series_id": "commercial", "series_name": "Commercial", "date": date, "value": c, "unit": "mio CZK", "competitor_id": comp})
        other = t - r - c
        if abs(other) > 0.5:
            result.append({"series_id": "other", "series_name": "Other", "date": date, "value": other, "unit": "mio CZK", "competitor_id": comp})

    return sorted(result, key=lambda x: (x["date"], x["series_name"]))


def _int_or_none(val: str | None) -> int | None:
    if val is None:
        return None
    try:
        return int(val)
    except ValueError:
        return None


def _parse_json_field(val) -> list | dict:
    if isinstance(val, (list, dict)):
        return val
    if isinstance(val, str) and val:
        try:
            return json.loads(val)
        except (json.JSONDecodeError, TypeError):
            pass
    return []
