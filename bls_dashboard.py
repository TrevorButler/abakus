"""
bls_dashboard.py

BLS QCEW employment/wages charts -- county-level, 2-digit NAICS. Mirrors
demographics_dashboard.py's shape (shared engine, {chart_type, ...} chart
results, concurrent query execution) with one deliberate structural
difference: ACS's 27 charts are a fixed set, but BLS sectors are
individually user-toggleable at request time (default all on), so the
per-sector trend charts can't live as static CHART_FUNCTIONS dict keys the
way ACS's chart functions do -- they're built dynamically per selected
sector in get_full_dashboard()/get_full_dashboard_region() instead.

Sum-then-derive applies here exactly as in demographics_dashboard.py:
a region's avg_annual_pay is always recomputed as SUM(wages)/SUM(employment)
after summing employment and wages in SQL, never averaged directly (an
"average of averages" would silently misweight small vs large counties).
"""

import os
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/census_dashboard")

MAX_DASHBOARD_WORKERS = 10

TOTAL_INDUSTRY_CODE = "10"

# All 20 real 2-digit NAICS/QCEW sectors -- the dashboard/comparative views'
# full sector set. '99' (Unclassified) and '10' (Total) are deliberately
# excluded: confirmed via a live QCEW pull that '99' isn't a real industry
# and '10' is the grand total, not a sector.
NAICS_SECTORS = {
    "11": "Agriculture, Forestry, Fishing and Hunting",
    "21": "Mining, Quarrying, and Oil and Gas Extraction",
    "22": "Utilities",
    "23": "Construction",
    "31-33": "Manufacturing",
    "42": "Wholesale Trade",
    "44-45": "Retail Trade",
    "48-49": "Transportation and Warehousing",
    "51": "Information",
    "52": "Finance and Insurance",
    "53": "Real Estate and Rental and Leasing",
    "54": "Professional, Scientific, and Technical Services",
    "55": "Management of Companies and Enterprises",
    "56": "Administrative and Support and Waste Management and Remediation Services",
    "61": "Educational Services",
    "62": "Health Care and Social Assistance",
    "71": "Arts, Entertainment, and Recreation",
    "72": "Accommodation and Food Services",
    "81": "Other Services (except Public Administration)",
    "92": "Public Administration",
}

# Office Demand's narrower sector set -- unchanged, kept separate from
# NAICS_SECTORS since that module's sqft-per-employee coefficients only
# make sense for professional/office and medical employment, not all 20.
PROFESSIONAL_SECTORS = {
    "51": "Information",
    "52": "Finance and Insurance",
    "53": "Real Estate and Rental and Leasing",
    "54": "Professional, Scientific, and Technical Services",
    "55": "Management of Companies and Enterprises",
    "56": "Administrative and Support and Waste Management and Remediation Services",
}
HEALTHCARE_SECTOR = {"62": "Health Care and Social Assistance"}
ALL_SECTORS = {**PROFESSIONAL_SECTORS, **HEALTHCARE_SECTOR}


def get_engine():
    return create_engine(DATABASE_URL, pool_size=10, max_overflow=10, pool_pre_ping=True)


def fetch_sector_series(engine, geoid, naics_codes: list, start_year: int, end_year: int) -> dict:
    """Returns {year: {naics_code: {"employment": x, "wages": y, "avg_pay": z}}}.
    geoid may be a single county geoid (str) or a list (region) -- SUMs
    employment/wages in SQL across geoids before any further math; avg_pay
    is always recomputed post-sum, never fetched/averaged directly."""
    is_region = isinstance(geoid, (list, tuple))
    with engine.connect() as conn:
        if is_region:
            rows = conn.execute(
                text("""
                    SELECT year, naics_code, SUM(annual_avg_emplvl) AS emplvl, SUM(total_annual_wages) AS wages
                    FROM bls_qcew_estimates
                    WHERE geoid = ANY(:geoids) AND naics_code = ANY(:codes) AND year BETWEEN :start AND :end
                    GROUP BY year, naics_code
                """),
                {"geoids": list(geoid), "codes": naics_codes, "start": start_year, "end": end_year},
            )
        else:
            rows = conn.execute(
                text("""
                    SELECT year, naics_code, annual_avg_emplvl AS emplvl, total_annual_wages AS wages
                    FROM bls_qcew_estimates
                    WHERE geoid = :geoid AND naics_code = ANY(:codes) AND year BETWEEN :start AND :end
                """),
                {"geoid": geoid, "codes": naics_codes, "start": start_year, "end": end_year},
            )
        data = {}
        for row in rows:
            if row.emplvl is None or row.wages is None:
                continue
            emplvl, wages = float(row.emplvl), float(row.wages)
            data.setdefault(row.year, {})[row.naics_code] = {
                "employment": emplvl,
                "wages": wages,
                "avg_pay": wages / emplvl if emplvl else None,
            }
        return data


def employment_by_sector(engine, geoid, sectors: list, start_year: int, end_year: int) -> dict:
    """multi_line: each selected sector's raw employment trend, all on one
    chart -- a percent-of-selected-sectors share (the original stacked_bar
    design) wasn't a useful view in practice; users want to compare
    absolute employment levels across sectors directly."""
    data = fetch_sector_series(engine, geoid, sectors, start_year, end_year)
    series_by_label = {NAICS_SECTORS[code]: {} for code in sectors}
    for year, by_code in data.items():
        for code, v in by_code.items():
            series_by_label[NAICS_SECTORS[code]][year] = v["employment"]
    return {"chart_type": "multi_line", "series_by_label": series_by_label}


def avg_pay_by_sector(engine, geoid, sectors: list, start_year: int, end_year: int) -> dict:
    """multi_line: each selected sector's average annual pay trend, all on
    one chart. Originally this showed raw total dollar wages per sector
    (mirroring employment_by_sector's raw counts), but that made a region's
    chart dominated by whichever sectors simply have the most total
    payroll rather than showing anything about compensation levels --
    average pay per employee (already correctly weighted via SUM(wages)/
    SUM(employment) in fetch_sector_series, same math the per-sector
    Average Annual Pay trend charts use) is the more useful cross-sector
    comparison, confirmed by explicit feedback."""
    data = fetch_sector_series(engine, geoid, sectors, start_year, end_year)
    series_by_label = {NAICS_SECTORS[code]: {} for code in sectors}
    for year, by_code in data.items():
        for code, v in by_code.items():
            if v["avg_pay"] is not None:
                series_by_label[NAICS_SECTORS[code]][year] = v["avg_pay"]
    return {"chart_type": "multi_line", "series_by_label": series_by_label}


def sector_employment_trend(engine, geoid, naics_code: str, start_year: int, end_year: int) -> dict:
    data = fetch_sector_series(engine, geoid, [naics_code], start_year, end_year)
    return {"chart_type": "line", "series": {y: v[naics_code]["employment"] for y, v in data.items() if naics_code in v}}


def sector_wage_trend(engine, geoid, naics_code: str, start_year: int, end_year: int) -> dict:
    data = fetch_sector_series(engine, geoid, [naics_code], start_year, end_year)
    return {"chart_type": "line", "series": {y: v[naics_code]["wages"] for y, v in data.items() if naics_code in v}}


def sector_avg_pay_trend(engine, geoid, naics_code: str, start_year: int, end_year: int) -> dict:
    data = fetch_sector_series(engine, geoid, [naics_code], start_year, end_year)
    return {
        "chart_type": "line",
        "series": {y: v[naics_code]["avg_pay"] for y, v in data.items() if naics_code in v and v[naics_code]["avg_pay"] is not None},
    }


def _run_dashboard_queries(engine, geoid, start_year: int, end_year: int, sectors: list) -> dict:
    """Concurrently runs employment_by_sector/avg_pay_by_sector plus one
    employment/wage/avg-pay trend chart per selected sector -- same
    ThreadPoolExecutor rationale as demographics_dashboard.py's
    _run_chart_functions (independent read-only queries, no data
    dependency between them, overlapping cold-cache disk-wait time)."""
    with ThreadPoolExecutor(max_workers=MAX_DASHBOARD_WORKERS) as pool:
        futures = {
            "employment_by_sector": pool.submit(employment_by_sector, engine, geoid, sectors, start_year, end_year),
            "avg_pay_by_sector": pool.submit(avg_pay_by_sector, engine, geoid, sectors, start_year, end_year),
        }
        for code in sectors:
            futures[f"employment_trend_{code}"] = pool.submit(sector_employment_trend, engine, geoid, code, start_year, end_year)
            futures[f"wage_trend_{code}"] = pool.submit(sector_wage_trend, engine, geoid, code, start_year, end_year)
            futures[f"avg_pay_trend_{code}"] = pool.submit(sector_avg_pay_trend, engine, geoid, code, start_year, end_year)
        return {name: future.result() for name, future in futures.items()}


def get_full_dashboard(geoid: str, start_year: int, end_year: int, sectors: list, engine=None) -> dict:
    engine = engine or get_engine()
    return _run_dashboard_queries(engine, geoid, start_year, end_year, sectors)


def get_full_dashboard_region(geoids: list, start_year: int, end_year: int, sectors: list, engine=None) -> dict:
    """Aggregated regional view: employment/wages sum cleanly across
    geoids (fetch_sector_series sums in SQL before any percentage/avg-pay
    math), so unlike ACS's true medians, nothing needs to be excluded here."""
    engine = engine or get_engine()
    return _run_dashboard_queries(engine, geoids, start_year, end_year, sectors)


def list_charts() -> list:
    return ["employment_by_sector", "avg_pay_by_sector"] + [
        f"{metric}_trend_{code}" for code in NAICS_SECTORS for metric in ("employment", "wage", "avg_pay")
    ]
