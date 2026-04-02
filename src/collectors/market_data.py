"""Import bank financial data from Excel (bb_values.xlsx format)."""

import logging
from datetime import datetime
from pathlib import Path

import openpyxl

from src.collectors.base import BaseCollector
from src.models.database import Database

logger = logging.getLogger(__name__)

# Map Excel bank abbreviations to competitor IDs
BANK_ID_MAP = {
    "RB": "raiffeisenbank",
    "Moneta": "moneta",
    "ČSOB": "csob",
    "ČS": "ceska_sporitelna",
    "KB": "komercni_banka",
    "FIO": "fio_banka",
    "UNI": "unicredit",
}


def import_financials(db: Database, excel_path: str) -> int:
    """Parse bb_values.xlsx and load all metrics into the DB.

    File format: sections of 11 rows each:
      Row 1: section category header (e.g. "Assets")
      Row 2: metric name + date columns (e.g. "Total Assets (mio CZK) - EoP | 3/31/2022 | ...")
      Row 3: column index numbers (skip)
      Rows 4-10: bank data (RB, Moneta, ČSOB, ČS, KB, FIO, UNI)
      Row 11: blank separator
    """
    wb = openpyxl.load_workbook(excel_path, data_only=True)
    ws = wb["Sheet1"]

    total = 0
    row = 1
    max_row = ws.max_row

    while row <= max_row:
        # Find next section: look for a row where col A has text and col B has a date
        metric_row = None
        for r in range(row, min(row + 5, max_row + 1)):
            cell_b = ws.cell(row=r, column=2).value
            if cell_b and _is_date(cell_b):
                metric_row = r
                break

        if metric_row is None:
            row += 1
            continue

        # Parse metric name from column A
        series_name = str(ws.cell(row=metric_row, column=1).value or "").strip()
        if not series_name:
            row = metric_row + 10
            continue

        # Derive series_id and category
        series_id, category, unit = _classify_metric(series_name)

        # Parse date columns (columns B onwards)
        dates = []
        for col in range(2, ws.max_column + 1):
            val = ws.cell(row=metric_row, column=col).value
            if val and _is_date(val):
                dates.append((col, _parse_date(val)))
            elif val is None:
                break

        if not dates:
            row = metric_row + 10
            continue

        # Parse bank data rows (typically rows metric_row+2 through metric_row+8)
        data_start = metric_row + 2  # skip the "1 | 6 | 7 | ..." index row
        for r in range(data_start, min(data_start + 8, max_row + 1)):
            bank_label = ws.cell(row=r, column=1).value
            if not bank_label:
                continue
            bank_label = str(bank_label).strip()
            comp_id = BANK_ID_MAP.get(bank_label)
            if not comp_id:
                continue

            for col, date_str in dates:
                val = ws.cell(row=r, column=col).value
                if val is None:
                    continue
                try:
                    value = float(val)
                except (ValueError, TypeError):
                    continue

                db.upsert_metric(
                    source="excel",
                    series_id=series_id,
                    series_name=series_name,
                    category=category,
                    date=date_str,
                    value=value,
                    unit=unit,
                    competitor_id=comp_id,
                )
                total += 1

        row = data_start + 8  # skip to next section
        logger.info("Imported %s: %s", series_id, series_name)

    wb.close()
    logger.info("Total imported: %d data points", total)
    return total


def _is_date(val) -> bool:
    """Check if a cell value looks like a date."""
    if isinstance(val, datetime):
        return True
    s = str(val).strip()
    return "/" in s and len(s) <= 12


def _parse_date(val) -> str:
    """Convert cell date to YYYY-MM-DD."""
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    # Parse "3/31/2022" format
    s = str(val).strip()
    parts = s.split("/")
    if len(parts) == 3:
        month, day, year = parts
        return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
    return s


# ── Metric classification ───────────────────────────────────────

METRIC_MAP = {
    "Total Assets": ("total_assets", "balance_sheet", "mio CZK"),
    "Total Liabilities": ("total_liabilities", "balance_sheet", "mio CZK"),
    "Total Equity": ("total_equity", "balance_sheet", "mio CZK"),
    "Loans and receivables to Banks": ("loans_to_banks", "balance_sheet", "mio CZK"),
    "Deposits received from Banks": ("deposits_from_banks", "balance_sheet", "mio CZK"),
    "Loans and receivables to Customers": ("loans_to_customers", "loans", "mio CZK"),
    "Deposits received from Customers": ("customer_deposits", "balance_sheet", "mio CZK"),
    "Intangible Assets": ("intangible_assets", "balance_sheet", "mio CZK"),
    "Debt Securties": ("debt_securities", "balance_sheet", "mio CZK"),
    "ROE - QTD": ("roe_qtd", "profitability", "%"),
    "ROE - YTD": ("roe_ytd", "profitability", "%"),
    "Operating Income (mio CZK) - QTD": ("op_income_qtd", "income", "mio CZK"),
    "Operating Income (mio CZK) - YTD": ("op_income_ytd", "income", "mio CZK"),
    "Operating Expense (mio CZK) - QTD": ("op_expense_qtd", "expenses", "mio CZK"),
    "Operating Expense (mio CZK) - YTD": ("op_expense_ytd", "expenses", "mio CZK"),
    "Net Operating Income (mio CZK) - QTD": ("net_op_income_qtd", "income", "mio CZK"),
    "Net Operating Income (mio CZK) - YTD": ("net_op_income_ytd", "income", "mio CZK"),
    "Cost to Income Ratio (%) - QTD": ("cir_qtd", "profitability", "%"),
    "Cost to Income Ratio (%) - YTD": ("cir_ytd", "profitability", "%"),
    "Net Profit after tax (mio CZK) - QTD": ("npat_qtd", "profitability", "mio CZK"),
    "Net Profit after tax (mio CZK) - YTD": ("npat_ytd", "profitability", "mio CZK"),
    "Profit after tax  per Employee (CZK) - QTD": ("npat_per_employee_qtd", "efficiency", "CZK"),
    "Profit after tax per Client (CZK) - QTD": ("npat_per_client_qtd", "efficiency", "CZK"),
    "Operating Income per Employee (CZK) - QTD": ("op_income_per_employee_qtd", "efficiency", "CZK"),
    "Operating Income per Client (CZK) - QTD": ("op_income_per_client_qtd", "efficiency", "CZK"),
    "Operating Expense per Employee (CZK) - QTD": ("op_expense_per_employee_qtd", "efficiency", "CZK"),
    "Operating Expense per Client (CZK) - QTD": ("op_expense_per_client_qtd", "efficiency", "CZK"),
    "Net Operating Income per Employee (CZK) - QTD": ("net_op_income_per_employee_qtd", "efficiency", "CZK"),
    "Net Operating Income per Client (CZK) - QTD": ("net_op_income_per_client_qtd", "efficiency", "CZK"),
    "Number of FTE - EoP": ("fte", "operations", "FTE"),
    "Number of clients (mio) - EoP": ("clients", "operations", "mil"),
    "Loans Total (mio CZK)": ("loans_total", "loans", "mio CZK"),
    "Retail Loans Total (mio CZK)": ("loans_retail", "loans", "mio CZK"),
    "Commercial Loans Total (mio CZK)": ("loans_commercial", "loans", "mio CZK"),
    "Mortgages Total (mio CZK)": ("mortgages", "loans", "mio CZK"),
    "Interest Income (mio CZK) - QTD": ("interest_income_qtd", "nii", "mio CZK"),
    "Interest Income (mio CZK) - YTD": ("interest_income_ytd", "nii", "mio CZK"),
    "Interest Expense (mio CZK) - QTD": ("interest_expense_qtd", "nii", "mio CZK"),
    "Interest Expense (mio CZK) - YTD": ("interest_expense_ytd", "nii", "mio CZK"),
    "Net Interest Income (mio CZK) - QTD": ("nii_qtd", "nii", "mio CZK"),
    "Net Interest Income (mio CZK) - YTD": ("nii_ytd", "nii", "mio CZK"),
    "Net Interest Margin - QTD": ("nim_qtd", "nii", "%"),
    "Net Interest Margin - YTD": ("nim_ytd", "nii", "%"),
    "Net Fees&Commissions  (mio CZK) - QTD": ("net_fees_qtd", "income", "mio CZK"),
    "Net Fees&Commissions  (mio CZK) - YTD": ("net_fees_ytd", "income", "mio CZK"),
    "Personnel Expense (mio CZK) - QTD": ("perex_qtd", "expenses", "mio CZK"),
    "Personnel Expense (mio CZK) - YTD": ("perex_ytd", "expenses", "mio CZK"),
    "General Administrative Expenses (mio CZK) - QTD": ("gae_qtd", "expenses", "mio CZK"),
    "General Administrative Expenses (mio CZK) - YTD": ("gae_ytd", "expenses", "mio CZK"),
    "Regulatory charges (mio CZK) - QTD": ("reg_charges_qtd", "expenses", "mio CZK"),
    "Regulatory charges (mio CZK) - YTD": ("reg_charges_ytd", "expenses", "mio CZK"),
    "Depreciation and Amortisation (mio CZK) - QTD": ("depreciation_qtd", "expenses", "mio CZK"),
    "Depreciation and Amortisation (mio CZK) - YTD": ("depreciation_ytd", "expenses", "mio CZK"),
    "Other Operating Result (mio CZK) - QTD": ("other_op_result_qtd", "income", "mio CZK"),
    "Other Operating Result (mio CZK) - YTD": ("other_op_result_ytd", "income", "mio CZK"),
    "Personnel Expense per Employee (CZK) - QTD": ("perex_per_employee_qtd", "efficiency", "CZK"),
    "GAE per Employee (CZK) - QTD": ("gae_per_employee_qtd", "efficiency", "CZK"),
    "Personnel Expense per Client (CZK) - QTD": ("perex_per_client_qtd", "efficiency", "CZK"),
    "GAE per Client(CZK) - QTD": ("gae_per_client_qtd", "efficiency", "CZK"),
    "Liquidity Coverage Ratio": ("lcr", "regulatory", "%"),
    "Net Stable Funding Ratio": ("nsfr", "regulatory", "%"),
    "Effective Tax Rate - YTD": ("effective_tax_rate_ytd", "profitability", "%"),
    "Capital Adequacy (% of RWA)": ("capital_adequacy", "regulatory", "%"),
    "Non-Performing Loans (%)": ("npl_ratio", "risk", "%"),
    "MREL": ("mrel", "regulatory", "%"),
    "Ratings (long-term)": ("rating", "regulatory", "rating"),
    "Risk Costs - QTD (mio CZK)": ("risk_costs_qtd", "risk", "mio CZK"),
    "Risk Weighted Assets (mio CZK)": ("rwa", "risk", "mio CZK"),
    "Risk Charge (%)": ("risk_charge", "risk", "%"),
}


def _classify_metric(name: str) -> tuple[str, str, str]:
    """Return (series_id, category, unit) for a metric name."""
    # Exact match first
    if name in METRIC_MAP:
        return METRIC_MAP[name]

    # Partial match
    for key, (sid, cat, unit) in METRIC_MAP.items():
        if key in name or name in key:
            return sid, cat, unit

    # Fallback: slugify the name
    slug = name.lower().replace(" ", "_").replace("(", "").replace(")", "")[:40]
    return slug, "other", ""


class MarketDataCollector(BaseCollector):
    """Collector that imports bank financials from Excel."""
    name = "market_data"
    rate_limit_delay = 0
    required_source_key = None

    def collect(self, competitor_id: str) -> list:
        return []

    def run(self, competitor_ids: list[str] | None = None) -> dict:
        """Import from Excel file if present in config/."""
        run_id = self.db.start_collector_run(self.name, None)

        excel_path = self.config_dir / "bb_values.xlsx"
        if not excel_path.exists():
            # Also check data/ directory
            excel_path = Path("data") / "bb_values.xlsx"

        if not excel_path.exists():
            self.db.finish_collector_run(run_id, "failed", error_message="bb_values.xlsx not found in config/ or data/")
            return {"total": 0, "new_signals": 0, "errors": 1,
                    "competitors": {"_market_data": {"status": "failed", "error": "bb_values.xlsx not found"}}}

        try:
            total = import_financials(self.db, str(excel_path))
            self.db.finish_collector_run(run_id, "success", total)
            return {"total": total, "new_signals": total, "errors": 0,
                    "competitors": {"_market_data": {"status": "success", "signals": total}}}
        except Exception as e:
            self.db.finish_collector_run(run_id, "failed", error_message=str(e))
            return {"total": 0, "new_signals": 0, "errors": 1,
                    "competitors": {"_market_data": {"status": "failed", "error": str(e)}}}
