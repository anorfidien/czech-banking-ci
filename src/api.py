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
            # Parse JSON fields
            for sig in signals:
                sig["tags"] = _parse_json_field(sig.get("tags", "[]"))
                sig["metadata"] = _parse_json_field(sig.get("metadata", "{}"))
            return jsonify(signals)
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
