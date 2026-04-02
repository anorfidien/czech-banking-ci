"""Collector for Czech banking market data from ČNB and ČSÚ."""

import csv
import io
import json
import logging
from datetime import datetime

from src.collectors.base import BaseCollector, CollectorError
from src.models.database import Database

logger = logging.getLogger(__name__)

# ── Series definitions ──────────────────────────────────────────
# Each tuple: (series_id, series_name, category, unit, fetch_function_name)

CNB_SERIES = [
    # PRIBOR interbank rates
    {"id": "cnb:pribor_1d", "name": "PRIBOR 1 den", "category": "rates", "unit": "%"},
    {"id": "cnb:pribor_1w", "name": "PRIBOR 1 týden", "category": "rates", "unit": "%"},
    {"id": "cnb:pribor_3m", "name": "PRIBOR 3 měsíce", "category": "rates", "unit": "%"},
    {"id": "cnb:pribor_6m", "name": "PRIBOR 6 měsíců", "category": "rates", "unit": "%"},
    {"id": "cnb:pribor_1y", "name": "PRIBOR 1 rok", "category": "rates", "unit": "%"},
    # FX
    {"id": "cnb:eur_czk", "name": "EUR/CZK kurz", "category": "fx", "unit": "CZK"},
    {"id": "cnb:usd_czk", "name": "USD/CZK kurz", "category": "fx", "unit": "CZK"},
]

PRIBOR_TERM_MAP = {
    "1 den": "cnb:pribor_1d",
    "7 dní": "cnb:pribor_1w",
    "3 měsíce": "cnb:pribor_3m",
    "6 měsíců": "cnb:pribor_6m",
    "1 rok": "cnb:pribor_1y",
}

CZSO_DATASETS = [
    {
        "id": "czso:cpi",
        "name": "Index spotřebitelských cen (CPI)",
        "category": "macro",
        "unit": "index",
        "package": "010022",
    },
]

CNB_PRIBOR_URL = "https://www.cnb.cz/cs/financni_trhy/penezni_trh/pribor/denni.txt"
CNB_FX_URL = "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt"
CNB_FX_HISTORY_URL = "https://www.cnb.cz/cs/financni_trhy/devizovy_trh/kurzy_devizoveho_trhu/vybrane.txt?od={start}&do={end}&mena={currency}"
CZSO_PACKAGE_URL = "https://vdb.czso.cz/pll/eweb/package_show?id={package}"


class MarketDataCollector(BaseCollector):
    name = "market_data"
    rate_limit_delay = 1.5
    required_source_key = None  # runs for all

    def collect(self, competitor_id: str) -> list:
        # This collector doesn't produce signals — it stores metrics directly.
        # We override run() instead.
        return []

    def run(self, competitor_ids: list[str] | None = None) -> dict:
        """Collect market data (not competitor-specific)."""
        run_id = self.db.start_collector_run(self.name, None)
        total = 0
        errors = []

        try:
            total += self._collect_pribor()
        except Exception as e:
            logger.error("PRIBOR collection failed: %s", e)
            errors.append(f"pribor: {e}")

        try:
            total += self._collect_fx()
        except Exception as e:
            logger.error("FX collection failed: %s", e)
            errors.append(f"fx: {e}")

        try:
            total += self._collect_fx_history("EUR", "cnb:eur_czk", "EUR/CZK kurz")
        except Exception as e:
            logger.error("EUR history failed: %s", e)
            errors.append(f"eur_history: {e}")

        try:
            total += self._collect_fx_history("USD", "cnb:usd_czk", "USD/CZK kurz")
        except Exception as e:
            logger.error("USD history failed: %s", e)
            errors.append(f"usd_history: {e}")

        try:
            total += self._collect_czso()
        except Exception as e:
            logger.error("CZSO collection failed: %s", e)
            errors.append(f"czso: {e}")

        status = "success" if not errors else ("partial" if total > 0 else "failed")
        self.db.finish_collector_run(
            run_id, status, total,
            "; ".join(errors) if errors else None,
        )

        logger.info("Market data: %d data points, %d errors", total, len(errors))
        return {
            "total": total,
            "new_signals": total,
            "errors": len(errors),
            "competitors": {"_market_data": {"status": status, "signals": total}},
        }

    # ── PRIBOR (today) ──────────────────────────────────────────

    def _collect_pribor(self) -> int:
        resp = self._fetch(CNB_PRIBOR_URL)
        lines = resp.text.strip().splitlines()
        if len(lines) < 3:
            return 0

        date_raw = lines[0].strip()
        date = self._parse_cz_date(date_raw)
        count = 0

        for line in lines[2:]:  # skip header
            parts = line.split("|")
            if len(parts) < 3:
                continue
            term = parts[0].strip()
            pribor_str = parts[2].strip() if len(parts) > 2 else parts[1].strip()
            series_id = PRIBOR_TERM_MAP.get(term)
            if not series_id or not pribor_str:
                continue
            value = float(pribor_str.replace(",", "."))
            series = next((s for s in CNB_SERIES if s["id"] == series_id), None)
            if series:
                self.db.upsert_metric(
                    "cnb", series_id, series["name"], series["category"],
                    date, value, series["unit"],
                )
                count += 1

        logger.info("PRIBOR: %d rates for %s", count, date)
        return count

    # ── FX rates (today) ────────────────────────────────────────

    def _collect_fx(self) -> int:
        resp = self._fetch(CNB_FX_URL)
        lines = resp.text.strip().splitlines()
        if len(lines) < 3:
            return 0

        date_raw = lines[0].split("#")[0].strip()
        date = self._parse_cz_date(date_raw)
        count = 0

        for line in lines[2:]:
            parts = line.split("|")
            if len(parts) < 5:
                continue
            code = parts[3].strip()
            amount = int(parts[2].strip())
            rate = float(parts[4].strip().replace(",", "."))
            per_unit = rate / amount

            if code == "EUR":
                self.db.upsert_metric("cnb", "cnb:eur_czk", "EUR/CZK kurz", "fx", date, per_unit, "CZK")
                count += 1
            elif code == "USD":
                self.db.upsert_metric("cnb", "cnb:usd_czk", "USD/CZK kurz", "fx", date, per_unit, "CZK")
                count += 1

        logger.info("FX: %d rates for %s", count, date)
        return count

    # ── FX history ──────────────────────────────────────────────

    def _collect_fx_history(self, currency: str, series_id: str, series_name: str) -> int:
        start = "01.01.2020"
        end = datetime.utcnow().strftime("%d.%m.%Y")
        url = CNB_FX_HISTORY_URL.format(start=start, end=end, currency=currency)

        resp = self._fetch(url)
        lines = resp.text.strip().splitlines()
        # Format: header line "Měna: EUR|Množství: 1", then "Datum|Kurz", then data
        count = 0
        for line in lines[2:]:  # skip 2 header lines
            parts = line.split("|")
            if len(parts) < 2:
                continue
            date = self._parse_cz_date(parts[0].strip())
            val_str = parts[1].strip().replace(",", ".")
            if not val_str:
                continue
            try:
                value = float(val_str)
            except ValueError:
                continue
            self.db.upsert_metric("cnb", series_id, series_name, "fx", date, value, "CZK")
            count += 1

        logger.info("FX history %s: %d data points", currency, count)
        return count

    # ── ČSÚ (CPI / inflation) ──────────────────────────────────

    def _collect_czso(self) -> int:
        total = 0
        for ds in CZSO_DATASETS:
            try:
                total += self._collect_czso_dataset(ds)
            except Exception as e:
                logger.warning("CZSO %s failed: %s", ds["id"], e)
        return total

    def _collect_czso_dataset(self, ds: dict) -> int:
        # Get dataset metadata to find CSV URL
        meta_url = CZSO_PACKAGE_URL.format(package=ds["package"])
        resp = self._fetch(meta_url)
        data = resp.json()

        if not data.get("success"):
            logger.warning("CZSO package %s not found", ds["package"])
            return 0

        resources = data.get("result", {}).get("resources", [])
        csv_url = None
        for r in resources:
            if r.get("format", "").lower() in ("text/csv", "csv"):
                csv_url = r["url"]
                break

        if not csv_url:
            logger.warning("No CSV resource in CZSO %s", ds["package"])
            return 0

        resp = self._fetch(csv_url)
        content = resp.text

        # Parse CSV — CZSO format varies but typically has columns for period and value
        reader = csv.DictReader(io.StringIO(content))
        count = 0

        for row in reader:
            # Look for period and value columns
            period = row.get("obdobi") or row.get("OBDOBI") or row.get("rok_mesic") or ""
            value_str = row.get("hodnota") or row.get("HODNOTA") or ""

            if not period or not value_str:
                continue

            # Parse period (formats: "202401", "2024M01", "2024-01")
            date = self._parse_czso_period(period)
            if not date:
                continue

            try:
                value = float(value_str.replace(",", "."))
            except ValueError:
                continue

            # Only store the aggregate CPI (typically the first/main indicator)
            # Filter for the main CPI index (COICOP = "0" or total)
            coicop = row.get("COICOP", row.get("ukazatel", ""))
            if coicop and coicop not in ("0", "CPI000000", "Úhrn", ""):
                continue

            self.db.upsert_metric(
                "czso", ds["id"], ds["name"], ds["category"],
                date, value, ds["unit"],
            )
            count += 1

        logger.info("CZSO %s: %d data points", ds["id"], count)
        return count

    # ── Helpers ──────────────────────────────────────────────────

    @staticmethod
    def _parse_cz_date(date_str: str) -> str:
        """Parse Czech date format DD.MM.YYYY to YYYY-MM-DD."""
        date_str = date_str.strip().rstrip(".")
        for fmt in ("%d.%m.%Y", "%d.%m.%y", "%Y-%m-%d"):
            try:
                return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
        return date_str

    @staticmethod
    def _parse_czso_period(period: str) -> str | None:
        """Parse CZSO period formats to YYYY-MM-DD."""
        period = period.strip()
        # "202401" or "2024M01"
        if len(period) == 6 and period.isdigit():
            return f"{period[:4]}-{period[4:]}-01"
        if "M" in period:
            parts = period.split("M")
            if len(parts) == 2:
                return f"{parts[0]}-{parts[1].zfill(2)}-01"
        if "-" in period and len(period) == 7:
            return f"{period}-01"
        return None
