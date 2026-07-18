"""
etl_bls_qcew_pull.py

Pulls BLS QCEW (Quarterly Census of Employment and Wages) annual-average
employment and wages for every county in the 7-state region, for the
Total-all-industries aggregate plus all 20 real two-digit NAICS sectors,
and loads them into `bls_qcew_estimates` (schema_bls.sql).

'99' (Unclassified) is deliberately excluded -- confirmed via a live pull
that it isn't a real industry (BLS's catch-all for unclassifiable
establishments), unlike the 20 genuine 2-digit sectors.

Uses the QCEW Open Data CSV API (data.bls.gov/cew/data/api/{year}/a/area/{fips}.csv)
-- NOT api.bls.gov's registered timeseries API, which is series-ID-oriented and
rate-limited far too low for a full county x sector x year pull. The Open Data
CSV endpoint needs no key/registration and returns every industry/ownership row
for one county-year per request.

Empirically confirmed against a live pull (Fulton County GA, 2023-2025) before
writing this:
  - own_code='0' (BLS's own "Total Covered," all-ownership) is published ONLY
    for industry_code='10' (Total, all industries), at agglvl_code='70'. It is
    NEVER published for individual 2-digit sectors -- their agglvl_code='74'
    rows only exist per-ownership-type (own_code in 1/2/3/5), so an all-
    ownership sector total must be summed from whatever own_code rows exist.
  - disclosure_code is non-blank ('N') on rows BLS has suppressed for
    confidentiality; annual_avg_emplvl/total_annual_wages read as 0 on those
    rows, but a suppressed 0 is not a real 0 -- it must be excluded from the
    sum, not added as zero.
  - Requesting a year with no annual file yet returns a 404 (verified: 2026
    404s while 2025 returns real, distinct data as of 2026-07) -- this is the
    signal used to auto-detect the latest available year rather than
    hardcoding one.
  - This endpoint only serves a ROLLING window, not the full historical
    archive -- discovered only after a full production run: 2010-2013 all
    404 even for a large county with unambiguously real underlying QCEW
    data. Confirmed via BLS's own documentation that pre-2014 data exists
    only through their separate bulk "Downloadable Data Files" (zipped,
    different format/endpoint, one file per year covering every US area),
    not this per-county API. MIN_YEAR reflects the real floor of what this
    endpoint can serve, not the originally-planned 2010 -- pulling 2010-2013
    would require a second script against that bulk-file mechanism, out of
    scope for now (explicitly deferred, not silently dropped).

Requires DATABASE_URL (no BLS API key needed).
"""

import csv
import io
import os
import time

import requests
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/census_dashboard")

MIN_YEAR = 2014  # earliest year this endpoint actually serves -- see module docstring
MAX_PROBE_YEAR = 2030  # descend from here looking for the newest year with a real annual file

TOTAL_INDUSTRY_CODE = "10"

# All 20 real 2-digit NAICS/QCEW sectors -- confirmed via a live pull
# (agglvl_code=74 rows for Fulton County GA) that this is the complete,
# real sector list; industry_code is literally "31-33"/"44-45"/"48-49"
# for the 3 multi-digit-range sectors, matching BLS's own CSV encoding.
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
SECTOR_TITLES = {TOTAL_INDUSTRY_CODE: "Total, All Industries", **NAICS_SECTORS}

MAX_RETRIES = 3
SLEEP_BETWEEN_REQUESTS = 0.1


def _get_with_retries(url: str) -> requests.Response | None:
    """Returns None on a 404 (year not published yet) rather than raising --
    every other failure mode still retries with backoff and eventually raises."""
    last_exc = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(url, timeout=60)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp
        except requests.RequestException as e:
            last_exc = e
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
    raise last_exc


def find_max_year() -> int:
    """Probes descending from MAX_PROBE_YEAR using a well-known large county
    (Fulton County, GA) and returns the first year with a real annual file."""
    for year in range(MAX_PROBE_YEAR, MIN_YEAR - 1, -1):
        resp = _get_with_retries(f"https://data.bls.gov/cew/data/api/{year}/a/area/13121.csv")
        if resp is not None:
            return year
    raise RuntimeError(f"No QCEW annual data found for any year in [{MIN_YEAR}, {MAX_PROBE_YEAR}]")


def fetch_county_year(area_fips: str, year: int) -> list[dict]:
    """Returns rows shaped for bls_qcew_estimates: one per (naics_code) in
    {TOTAL_INDUSTRY_CODE} | NAICS_SECTORS, or fewer if a sector is entirely
    suppressed for this county-year. Returns [] if the county has no file for
    this year at all (404) or the response is empty."""
    resp = _get_with_retries(f"https://data.bls.gov/cew/data/api/{year}/a/area/{area_fips}.csv")
    if resp is None:
        return []

    reader = csv.DictReader(io.StringIO(resp.text))
    all_rows = list(reader)
    if not all_rows:
        return []

    out = []

    total_row = next(
        (r for r in all_rows if r["industry_code"] == TOTAL_INDUSTRY_CODE
         and r["own_code"] == "0" and r["agglvl_code"] == "70" and not r["disclosure_code"].strip()),
        None,
    )
    if total_row is not None:
        emplvl = float(total_row["annual_avg_emplvl"])
        wages = float(total_row["total_annual_wages"])
        out.append({
            "geoid": area_fips, "year": year, "naics_code": TOTAL_INDUSTRY_CODE,
            "naics_title": SECTOR_TITLES[TOTAL_INDUSTRY_CODE],
            "annual_avg_emplvl": emplvl, "total_annual_wages": wages,
            "avg_annual_pay": wages / emplvl if emplvl else None,
        })

    for naics_code, naics_title in NAICS_SECTORS.items():
        sector_rows = [
            r for r in all_rows
            if r["industry_code"] == naics_code and r["agglvl_code"] == "74"
            and r["own_code"] != "0" and not r["disclosure_code"].strip()
        ]
        if not sector_rows:
            continue  # entirely suppressed or not present for this county-year -- skip, not a false zero
        emplvl = sum(float(r["annual_avg_emplvl"]) for r in sector_rows)
        wages = sum(float(r["total_annual_wages"]) for r in sector_rows)
        out.append({
            "geoid": area_fips, "year": year, "naics_code": naics_code, "naics_title": naics_title,
            "annual_avg_emplvl": emplvl, "total_annual_wages": wages,
            "avg_annual_pay": wages / emplvl if emplvl else None,
        })

    return out


def already_loaded(engine, geoid: str, year: int) -> bool:
    with engine.connect() as conn:
        result = conn.execute(
            text("SELECT 1 FROM bls_qcew_estimates WHERE geoid = :g AND year = :y LIMIT 1"),
            {"g": geoid, "y": year},
        )
        return result.first() is not None


def load_rows(engine, rows: list[dict]):
    if not rows:
        return
    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO bls_qcew_estimates
                    (geoid, year, naics_code, naics_title, annual_avg_emplvl, total_annual_wages, avg_annual_pay)
                VALUES (:geoid, :year, :naics_code, :naics_title, :annual_avg_emplvl, :total_annual_wages, :avg_annual_pay)
            """),
            rows,
        )


def main():
    engine = create_engine(DATABASE_URL)

    max_year = find_max_year()
    print(f"Latest available QCEW annual year: {max_year}")
    years = range(MIN_YEAR, max_year + 1)

    with engine.connect() as conn:
        counties = [r[0] for r in conn.execute(text("SELECT geoid FROM geography WHERE geo_type = 'county' ORDER BY geoid"))]
    print(f"{len(counties)} counties in scope")

    total_loaded = 0
    for geoid in counties:
        for year in years:
            if already_loaded(engine, geoid, year):
                continue
            rows = fetch_county_year(geoid, year)
            load_rows(engine, rows)
            total_loaded += len(rows)
            time.sleep(SLEEP_BETWEEN_REQUESTS)
        print(f"  {geoid}: done ({total_loaded} rows loaded so far)")

    print(f"Finished. {total_loaded} rows loaded.")


if __name__ == "__main__":
    main()
