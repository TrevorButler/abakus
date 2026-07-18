"""
excel_export.py

Shared openpyxl helpers for the CoStar/SmartRE "upload -> clean -> download"
modules (costar_heartbeat.py, costar_market_overview.py,
costar_multifamily_comps.py, smartre_sales.py). These modules take an
uploaded file's bytes in and return an in-memory openpyxl.Workbook out --
no engine, no DB writes, every run is a one-shot request.

openpyxl (not lib/download.ts's client-side SheetJS export) is used
specifically because it writes fully-native, editable Excel chart objects
for free -- SheetJS can only do that on a paid tier. This is a deliberate,
new architectural pattern for this app: everything else (ACS/BLS/PUMS) is
DB-backed and stateless-export-on-the-client; these modules are
stateless-clean-on-the-server instead.
"""

from io import BytesIO

from openpyxl.styles import Font

HEADER_FONT = Font(bold=True)


def unique_sheet_name(name: str, used: set) -> str:
    """Excel sheet names: max 31 chars, no : \\ / ? * [ ], no repeats.
    Mirrors frontend/src/lib/download.ts's uniqueSheetName() exactly."""
    safe = "".join(c for c in name if c not in ':\\/?*[]')[:31] or "Sheet"
    candidate = safe
    i = 2
    while candidate in used:
        suffix = f" ({i})"
        candidate = safe[: 31 - len(suffix)] + suffix
        i += 1
    used.add(candidate)
    return candidate


def write_table(ws, rows: list[list], start_row: int = 1, start_col: int = 1, bold_header: bool = True):
    """Writes a list-of-lists starting at (start_row, start_col); bolds the
    first row unless bold_header=False. Returns the row number just past
    the last written row, for callers stacking multiple tables on one
    sheet."""
    for r, row in enumerate(rows):
        for c, val in enumerate(row):
            cell = ws.cell(row=start_row + r, column=start_col + c, value=val)
            if bold_header and r == 0:
                cell.font = HEADER_FONT
    return start_row + len(rows)


def workbook_to_bytes(wb) -> bytes:
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
