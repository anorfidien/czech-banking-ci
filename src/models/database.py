import hashlib
import json
import logging
import os
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


class Database:
    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")

    def initialize(self):
        schema = SCHEMA_PATH.read_text(encoding="utf-8")
        self.conn.executescript(schema)
        self.conn.commit()
        logger.info("Database initialized at %s", self.db_path)

    def close(self):
        self.conn.close()

    # ── Competitors ──────────────────────────────────────────────

    def seed_competitors(self, config_dir: str):
        competitors_dir = Path(config_dir) / "competitors"
        if not competitors_dir.exists():
            logger.warning("No competitors directory at %s", competitors_dir)
            return
        count = 0
        for f in sorted(competitors_dir.glob("*.yaml")):
            data = yaml.safe_load(f.read_text(encoding="utf-8"))
            ico = data.get("sources", {}).get("ares_ico")
            self.conn.execute(
                """INSERT INTO competitors (id, name, parent_group, tier, ico, config_path)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                     name=excluded.name,
                     parent_group=excluded.parent_group,
                     tier=excluded.tier,
                     ico=excluded.ico,
                     config_path=excluded.config_path""",
                (data["id"], data["name"], data.get("parent_group"),
                 data["tier"], ico, str(f)),
            )
            count += 1
        self.conn.commit()
        logger.info("Seeded %d competitors", count)

    def get_competitors(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM competitors ORDER BY tier, name"
        ).fetchall()
        return [dict(r) for r in rows]

    def get_competitor(self, competitor_id: str) -> dict | None:
        row = self.conn.execute(
            "SELECT * FROM competitors WHERE id = ?", (competitor_id,)
        ).fetchone()
        return dict(row) if row else None

    # ── Signals ──────────────────────────────────────────────────

    def insert_signal(self, signal_dict: dict) -> bool:
        cursor = self.conn.execute(
            """INSERT OR IGNORE INTO signals
               (id, competitor_id, source, signal_type, title, content, url,
                detected_at, published_at, severity, tags, metadata,
                is_new, change_summary, content_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (signal_dict["id"], signal_dict["competitor_id"],
             signal_dict["source"], signal_dict["signal_type"],
             signal_dict["title"], signal_dict["content"],
             signal_dict["url"], signal_dict["detected_at"],
             signal_dict.get("published_at"),
             signal_dict["severity"],
             signal_dict["tags"], signal_dict["metadata"],
             signal_dict.get("is_new", 1),
             signal_dict.get("change_summary"),
             signal_dict["content_hash"]),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def get_signals(
        self,
        competitor_id: str | None = None,
        source: str | None = None,
        min_severity: int | None = None,
        since: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        query = "SELECT * FROM signals WHERE 1=1"
        params: list = []
        if competitor_id:
            query += " AND competitor_id = ?"
            params.append(competitor_id)
        if source:
            query += " AND source = ?"
            params.append(source)
        if min_severity:
            query += " AND severity >= ?"
            params.append(min_severity)
        if since:
            query += " AND detected_at >= ?"
            params.append(since)
        query += " ORDER BY detected_at DESC"
        if limit:
            query += " LIMIT ?"
            params.append(limit)
        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    # ── Snapshots ────────────────────────────────────────────────

    def get_latest_snapshot(
        self, competitor_id: str, source: str, snapshot_key: str
    ) -> dict | None:
        row = self.conn.execute(
            """SELECT * FROM snapshots
               WHERE competitor_id = ? AND source = ? AND snapshot_key = ?
               ORDER BY captured_at DESC LIMIT 1""",
            (competitor_id, source, snapshot_key),
        ).fetchone()
        return dict(row) if row else None

    def get_previous_snapshot(
        self, competitor_id: str, source: str, snapshot_key: str
    ) -> dict | None:
        row = self.conn.execute(
            """SELECT * FROM snapshots
               WHERE competitor_id = ? AND source = ? AND snapshot_key = ?
               ORDER BY captured_at DESC LIMIT 1 OFFSET 1""",
            (competitor_id, source, snapshot_key),
        ).fetchone()
        return dict(row) if row else None

    def insert_snapshot(
        self, competitor_id: str, source: str, snapshot_key: str,
        content: str, content_hash: str,
    ) -> bool:
        try:
            self.conn.execute(
                """INSERT INTO snapshots
                   (competitor_id, source, snapshot_key, content, content_hash, captured_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (competitor_id, source, snapshot_key, content, content_hash,
                 datetime.utcnow().isoformat()),
            )
            self.conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False

    # ── Collector Runs ───────────────────────────────────────────

    def start_collector_run(
        self, collector_name: str, competitor_id: str | None = None
    ) -> int:
        cursor = self.conn.execute(
            """INSERT INTO collector_runs
               (collector_name, competitor_id, started_at, status)
               VALUES (?, ?, ?, 'running')""",
            (collector_name, competitor_id, datetime.utcnow().isoformat()),
        )
        self.conn.commit()
        return cursor.lastrowid

    def finish_collector_run(
        self, run_id: int, status: str,
        signals_found: int = 0, error_message: str | None = None,
    ):
        self.conn.execute(
            """UPDATE collector_runs
               SET finished_at = ?, status = ?, signals_found = ?, error_message = ?
               WHERE id = ?""",
            (datetime.utcnow().isoformat(), status, signals_found,
             error_message, run_id),
        )
        self.conn.commit()

    def get_collector_status(self) -> list[dict]:
        rows = self.conn.execute(
            """SELECT collector_name, competitor_id, started_at, finished_at,
                      status, signals_found, error_message
               FROM collector_runs
               ORDER BY started_at DESC
               LIMIT 50"""
        ).fetchall()
        return [dict(r) for r in rows]

    # ── Metrics ─────────────────────────────────────────────────

    def upsert_metric(
        self, source: str, series_id: str, series_name: str,
        category: str, date: str, value: float,
        unit: str | None = None, competitor_id: str | None = None,
    ) -> bool:
        cursor = self.conn.execute(
            """INSERT OR REPLACE INTO metrics
               (source, series_id, series_name, category, date, value, unit, competitor_id, captured_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (source, series_id, series_name, category, date, value,
             unit, competitor_id, datetime.utcnow().isoformat()),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def get_metrics(
        self,
        series_id: str | None = None,
        category: str | None = None,
        competitor_id: str | None = None,
        since: str | None = None,
        until: str | None = None,
    ) -> list[dict]:
        query = "SELECT * FROM metrics WHERE 1=1"
        params: list = []
        if series_id:
            query += " AND series_id = ?"
            params.append(series_id)
        if category:
            query += " AND category = ?"
            params.append(category)
        if competitor_id:
            query += " AND competitor_id = ?"
            params.append(competitor_id)
        if since:
            query += " AND date >= ?"
            params.append(since)
        if until:
            query += " AND date <= ?"
            params.append(until)
        query += " ORDER BY date ASC"
        rows = self.conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    def get_available_series(self) -> list[dict]:
        rows = self.conn.execute(
            """SELECT series_id, series_name, category, unit, competitor_id,
                      COUNT(*) as points, MIN(date) as first_date, MAX(date) as last_date
               FROM metrics
               GROUP BY series_id, competitor_id
               ORDER BY category, series_name"""
        ).fetchall()
        return [dict(r) for r in rows]
