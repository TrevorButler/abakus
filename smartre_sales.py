"""
smartre_sales.py

Cleans up to 20 SmartRE sales-download files (each capped at ~1,000 rows by
SmartRE's own export limit, confirmed identical schema across split files)
into 12 cuts of sale-price/volume-over-time analysis for a user-chosen
comp set of Subdivisions, plus a combined sales list.

12 cuts (confirmed): Overall/New/Resale (all types, 3) + Single-
Family/Townhome/Condo (New+Resale combined, 3) + each of those 3 types x
New/Resale (6) = 12. Each cut gets a scatter chart (sale date x price, one
point per sale -- no connecting line, this is a dispersion plot, not a
trend line) and a stacked bar chart (year x price-bin counts).

Only Status == "Sold" rows are used -- "Active" rows are current listings,
not completed sales, and their Price is an asking price rather than a
closing price, so they don't belong in a sale-price/volume analysis.

No dedup across the up-to-20 uploaded files: the same home can legitimately
sell more than once within a multi-year window, so repeat rows for one
address are real, distinct sales, not duplicates (confirmed by the user).

Price bins (fixed, confirmed): under $50K, $50K bands up to $500K, $100K
bands up to $1M, then $1M+.
"""

import re
from datetime import date
from io import BytesIO

import openpyxl
from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference, ScatterChart, Series

from excel_export import unique_sheet_name, write_table

REQUIRED_COLUMNS = ["New/ Resale", "Status", "Type", "Subdivision", "Price", "Sqft", "Date"]

TYPE_LABELS = {"SF": "Single-Family", "T": "Townhome", "C": "Condo"}

MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
DATE_RE = re.compile(r"([A-Za-z]+)\s+(\d{4})")

# 12 cuts: (sheet name, New/Resale filter or None, Type code filter or None).
CUTS = [
    ("Overall", None, None),
    ("New", "New", None),
    ("Resale", "Resale", None),
    ("Single-Family", None, "SF"),
    ("Townhome", None, "T"),
    ("Condo", None, "C"),
    ("Single-Family - New", "New", "SF"),
    ("Single-Family - Resale", "Resale", "SF"),
    ("Townhome - New", "New", "T"),
    ("Townhome - Resale", "Resale", "T"),
    ("Condo - New", "New", "C"),
    ("Condo - Resale", "Resale", "C"),
]


def _build_price_bins():
    bins = [(0, 50_000, "Under $50K")]
    for lo in range(50_000, 500_000, 50_000):
        bins.append((lo, lo + 50_000, f"${lo // 1000}K-${(lo + 50_000) // 1000}K"))
    for lo in range(500_000, 1_000_000, 100_000):
        bins.append((lo, lo + 100_000, f"${lo // 1000}K-${(lo + 100_000) // 1000}K"))
    bins.append((1_000_000, None, "$1M+"))
    return bins


PRICE_BINS = _build_price_bins()
PRICE_BIN_LABELS = [b[2] for b in PRICE_BINS]


def price_bin_label(price: float) -> str:
    for lo, hi, label in PRICE_BINS:
        if hi is None:
            if price >= lo:
                return label
        elif lo <= price < hi:
            return label
    return PRICE_BINS[0][2]


def _parse_date(value):
    m = DATE_RE.match(str(value).strip()) if value else None
    if not m:
        return None
    month = MONTH_NAMES.get(m.group(1).lower())
    if not month:
        return None
    return date(int(m.group(2)), month, 1)


def _find_data_sheet(wb):
    for ws in wb.worksheets:
        if ws.max_row > 1:
            return ws
    raise ValueError("Uploaded file has no data rows")


def parse_sales_file(file_bytes: bytes) -> list[dict]:
    """Returns cleaned Sold-only rows. Raises ValueError if the upload
    doesn't look like a SmartRE sales download. The real header sits on
    row 2 (row 1 is SmartRE's own title cell, confirmed) but this probes
    both rows rather than hardcoding, in case that varies."""
    wb = openpyxl.load_workbook(BytesIO(file_bytes), data_only=True)
    ws = _find_data_sheet(wb)

    idx = None
    for candidate in (1, 2):
        headers = [c.value for c in next(ws.iter_rows(min_row=candidate, max_row=candidate))]
        candidate_idx = {h: i for i, h in enumerate(headers) if h}
        if all(c in candidate_idx for c in REQUIRED_COLUMNS):
            idx = candidate_idx
            header_row = candidate
            break
    if idx is None:
        raise ValueError("Missing expected column(s). Is this a SmartRE sales download?")

    rows = []
    for raw in ws.iter_rows(min_row=header_row + 1, values_only=True):
        if idx["Status"] >= len(raw) or raw[idx["Status"]] != "Sold":
            continue
        price = raw[idx["Price"]] if idx["Price"] < len(raw) else None
        if price is None:
            continue
        sale_date = _parse_date(raw[idx["Date"]]) if idx["Date"] < len(raw) else None
        rows.append({
            "new_resale": raw[idx["New/ Resale"]] if idx["New/ Resale"] < len(raw) else None,
            "type": raw[idx["Type"]] if idx["Type"] < len(raw) else None,
            "subdivision": str(raw[idx["Subdivision"]]) if idx["Subdivision"] < len(raw) and raw[idx["Subdivision"]] not in (None, "") else "N/a",
            "price": price,
            "sqft": raw[idx["Sqft"]] if idx["Sqft"] < len(raw) else None,
            "sale_date": sale_date,
            "county": raw[idx["County"]] if "County" in idx and idx["County"] < len(raw) else None,
            "zip": raw[idx["Zip"]] if "Zip" in idx and idx["Zip"] < len(raw) else None,
            "high_school": raw[idx["High School"]] if "High School" in idx and idx["High School"] < len(raw) else None,
        })
    return rows


def list_subdivisions(files_bytes: list[bytes]) -> list[str]:
    subs = set()
    for fb in files_bytes:
        for r in parse_sales_file(fb):
            subs.add(r["subdivision"])
    return sorted(subs)


def _filter_rows(rows: list[dict], new_resale, type_code) -> list[dict]:
    out = rows
    if new_resale is not None:
        out = [r for r in out if r["new_resale"] == new_resale]
    if type_code is not None:
        out = [r for r in out if r["type"] == type_code]
    return out


def _build_cut_sheet(wb: Workbook, name: str, rows: list[dict], used_names: set):
    ws = wb.create_sheet(unique_sheet_name(name, used_names))

    dated_rows = sorted((r for r in rows if r["sale_date"]), key=lambda r: r["sale_date"])
    scatter_table = [["Date", "Price"]] + [[r["sale_date"], r["price"]] for r in dated_rows]
    scatter_end = write_table(ws, scatter_table, start_row=1, start_col=1)

    years = sorted({r["sale_date"].year for r in dated_rows})
    counts = {y: {b: 0 for b in PRICE_BIN_LABELS} for y in years}
    for r in dated_rows:
        counts[r["sale_date"].year][price_bin_label(r["price"])] += 1
    bar_start_col = 4
    bar_table = [["Year"] + PRICE_BIN_LABELS] + [[y] + [counts[y][b] for b in PRICE_BIN_LABELS] for y in years]
    bar_end = write_table(ws, bar_table, start_row=1, start_col=bar_start_col)

    if dated_rows:
        chart1 = ScatterChart()
        chart1.title = f"{name} -- Sale Price Over Time"
        chart1.x_axis.title = "Date"
        chart1.y_axis.title = "Price"
        chart1.height, chart1.width = 10, 18
        xref = Reference(ws, min_col=1, min_row=2, max_row=scatter_end - 1)
        yref = Reference(ws, min_col=2, min_row=2, max_row=scatter_end - 1)
        series = Series(yref, xref, title="Sales")
        series.marker.symbol = "circle"
        series.graphicalProperties.line.noFill = True
        chart1.series.append(series)
        ws.add_chart(chart1, f"A{scatter_end + 2}")

    if years:
        chart2 = BarChart()
        chart2.type = "col"
        chart2.grouping = "stacked"
        chart2.overlap = 100
        chart2.title = f"{name} -- Sales by Year & Price Bin"
        chart2.y_axis.title = "Sales Count"
        chart2.x_axis.title = "Year"
        chart2.height, chart2.width = 10, 18
        data_ref = Reference(ws, min_col=bar_start_col + 1, max_col=bar_start_col + len(PRICE_BIN_LABELS), min_row=1, max_row=bar_end - 1)
        cats_ref = Reference(ws, min_col=bar_start_col, min_row=2, max_row=bar_end - 1)
        chart2.add_data(data_ref, titles_from_data=True)
        chart2.set_categories(cats_ref)
        ws.add_chart(chart2, f"A{scatter_end + 22}")


def build_sales_analysis_workbook(files_bytes: list[bytes], subdivisions: list[str]) -> Workbook:
    all_rows = []
    for fb in files_bytes:
        all_rows.extend(parse_sales_file(fb))
    selected = set(subdivisions)
    rows = [r for r in all_rows if r["subdivision"] in selected]
    if not rows:
        raise ValueError("No sold rows found for the selected subdivisions")

    wb = Workbook()
    wb.remove(wb.active)
    used_names: set = set()
    for name, new_resale, type_code in CUTS:
        _build_cut_sheet(wb, name, _filter_rows(rows, new_resale, type_code), used_names)

    ws = wb.create_sheet(unique_sheet_name("Combined Sales", used_names))
    header = ["New/Resale", "Type", "Subdivision", "Price", "Sqft", "Date", "County", "Zip", "High School"]
    table = [header] + [
        [r["new_resale"], TYPE_LABELS.get(r["type"], r["type"]), r["subdivision"], r["price"], r["sqft"], r["sale_date"], r["county"], r["zip"], r["high_school"]]
        for r in rows
    ]
    write_table(ws, table)
    return wb
