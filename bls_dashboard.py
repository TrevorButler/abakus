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
    """stacked_bar: each selected sector's share of SUMMED employment across
    just the selected sectors (not a share of the whole county economy)."""
    data = fetch_sector_series(engine, geoid, sectors, start_year, end_year)
    categories, raw_categories = {}, {}
    for year, by_code in data.items():
        total = sum(v["employment"] for v in by_code.values())
        if not total:
            continue
        categories[year] = {ALL_SECTORS[code]: v["employment"] / total for code, v in by_code.items()}
        raw_categories[year] = {ALL_SECTORS[code]: v["employment"] for code, v in by_code.items()}
    return {"chart_type": "stacked_bar", "categories": categories, "raw_categories": raw_categories}


def wages_by_sector(engine, geoid, sectors: list, start_year: int, end_year: int) -> dict:
    """stacked_bar: each selected sector's share of SUMMED total wages
    across just the selected sectors."""
    data = fetch_sector_series(engine, geoid, sectors, start_year, end_year)
    categories, raw_categories = {}, {}
    for year, by_code in data.items():
        total = sum(v["wages"] for v in by_code.values())
        if not total:
            continue
        categories[year] = {ALL_SECTORS[code]: v["wages"] / total for code, v in by_code.items()}
        raw_categories[year] = {ALL_SECTORS[code]: v["wages"] for code, v in by_code.items()}
    return {"chart_type": "stacked_bar", "categories": categories, "raw_categories": raw_categories}


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
    """Concurrently runs employment_by_sector/wages_by_sector plus one
    employment/wage/avg-pay trend chart per selected sector -- same
    ThreadPoolExecutor rationale as demographics_dashboard.py's
    _run_chart_functions (independent read-only queries, no data
    dependency between them, overlapping cold-cache disk-wait time)."""
    with ThreadPoolExecutor(max_workers=MAX_DASHBOARD_WORKERS) as pool:
        futures = {
            "employment_by_sector": pool.submit(employment_by_sector, engine, geoid, sectors, start_year, end_year),
            "wages_by_sector": pool.submit(wages_by_sector, engine, geoid, sectors, start_year, end_year),
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
    return ["employment_by_sector", "wages_by_sector"] + [
        f"{metric}_trend_{code}" for code in ALL_SECTORS for metric in ("employment", "wage", "avg_pay")
    ]
