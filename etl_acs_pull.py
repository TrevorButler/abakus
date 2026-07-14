"""
etl_acs_pull.py

Pulls ACS 5-year estimates for the 8 in-scope tables (DP04, DP05, S1101, S1901,
S2501, B19037, B25007, B25118) for every resolved geography, for years 2010-2024,
and loads them into the `acs_estimates` table (schema_v1.sql).

Requires:
    - geography_resolved.csv (output of resolve_geography.py, plus the manually
      confirmed rows from geography_needs_review.csv merged back in)
    - a Census API key, set as the CENSUS_API_KEY environment variable
      (never hardcode it here -- see note from earlier in our conversation)

The Census API caps requests at 50 variables per call, so each table's variable
list gets fetched in batches. Detail tables (B-prefixed) live at a different
dataset path than Data Profile (DP-prefixed) and Subject (S-prefixed) tables.
"""

import os
import time
import requests
import pandas as pd
from sqlalchemy import create_engine, text

CENSUS_API_KEY = os.environ["CENSUS_API_KEY"]  # fails loudly if not set -- good
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/census_dashboard")

YEARS = range(2010, 2025)  # ACS5 vintages: 2010 (2006-2010) through 2024 (2020-2024)

TABLES = {
    # table_id: dataset path suffix under /data/{year}/acs/acs5{suffix}
    "DP04": "/profile",
    "DP05": "/profile",
    "S1101": "/subject",
    "S1901": "/subject",
    "S2501": "/subject",
    "B19037": "",
    "B25007": "",
    "B25118": "",
}

BATCH_SIZE = 45  # stay under the 50-variable API limit, leave room for NAME
MAX_RETRIES = 3

# Census's documented sentinel codes for estimate/MOE cells that aren't real values
# (sample too small, universe of zero, median in an open-ended interval, etc).
# These parse as valid numbers, so they must be nulled out explicitly or they'll
# silently load as literal garbage (e.g. a "-666666666" median household income).
SENTINEL_CODES = {-666666666, -999999999, -888888888, -333333333, -555555555, -222222222}


def _get_with_retries(url: str, params: dict | None = None, timeout: int = 60) -> requests.Response:
    last_exc = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(url, params=params, timeout=timeout)
            resp.raise_for_status()
            return resp
        except requests.RequestException as e:
            last_exc = e
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
    raise last_exc


def get_table_variables(year: int, table_id: str, dataset_suffix: str) -> dict:
    """Returns {variable_code: label} for every variable belonging to table_id.

    variables.json only lists the "E" (estimate) code as a top-level key --
    the matching "M" (margin of error) code is queryable from the data endpoint
    but only shows up buried in the E variable's `attributes` string, never as
    its own key. So the M code has to be derived from the E code rather than
    discovered by iterating all_vars.
    """
    url = f"https://api.census.gov/data/{year}/acs/acs5{dataset_suffix}/variables.json"
    resp = _get_with_retries(url)
    all_vars = resp.json()["variables"]

    table_vars = {}
    for code, meta in all_vars.items():
        if meta.get("group") == table_id and code.endswith("E"):
            label = meta.get("label", code)
            table_vars[code] = label
            table_vars[code[:-1] + "M"] = label
    return table_vars


def fetch_batch(year: int, dataset_suffix: str, var_codes: list, geo_clause: dict) -> pd.DataFrame:
    url = f"https://api.census.gov/data/{year}/acs/acs5{dataset_suffix}"
    params = {
        "get": "NAME," + ",".join(var_codes),
        "key": CENSUS_API_KEY,
        **geo_clause,
    }
    resp = _get_with_retries(url, params=params)
    rows = resp.json()
    df = pd.DataFrame(rows[1:], columns=rows[0])
    return df


def pull_table_for_year(year: int, table_id: str, dataset_suffix: str, state_fips_list: list) -> tuple:
    try:
        table_vars = get_table_variables(year, table_id, dataset_suffix)
    except requests.RequestException as e:
        print(f"  [WARN] {table_id} {year}: could not fetch variable list, skipping ({e})")
        return pd.DataFrame(), {}
    var_codes = sorted(table_vars.keys())

    all_frames = []
    for state_fips in state_fips_list:
        for geo_type, geo_for in [("place", "place:*"), ("county", "county:*")]:
            geo_clause = {"for": geo_for, "in": f"state:{state_fips}"}
            for i in range(0, len(var_codes), BATCH_SIZE):
                batch = var_codes[i:i + BATCH_SIZE]
                try:
                    df = fetch_batch(year, dataset_suffix, batch, geo_clause)
                except requests.RequestException as e:
                    print(f"  [WARN] {table_id} {year} state {state_fips} {geo_type} batch {i}: {e}")
                    continue
                df["geo_type"] = geo_type
                df["state_fips"] = state_fips
                all_frames.append(df)
                time.sleep(0.2)  # be polite to the API

    if not all_frames:
        return pd.DataFrame(), table_vars

    combined = pd.concat(all_frames, ignore_index=True)
    return combined, table_vars


def reshape_to_long(raw_df: pd.DataFrame, table_vars: dict, table_id: str, year: int,
                     geography_lookup: pd.DataFrame) -> pd.DataFrame:
    """Wide (one row per geography, one column per variable) -> long fact rows."""
    id_cols = ["geo_type", "state_fips", "place", "county", "NAME"]
    id_cols = [c for c in id_cols if c in raw_df.columns]
    value_cols = [c for c in raw_df.columns if c in table_vars]

    long_df = raw_df.melt(id_vars=id_cols, value_vars=value_cols,
                           var_name="variable_code", value_name="raw_value")

    # Build geoid: state FIPS + place/county FIPS. Place-geo_type rows have a
    # "place" column and NaN "county"; county-geo_type rows are the reverse.
    # NB: `row.get("place") or row.get("county")` looks reasonable but is wrong --
    # a NaN float is truthy in Python, so the "or" never falls through to county
    # and every county row would get a geoid built from NaN. fillna avoids that.
    if "place" in long_df.columns and "county" in long_df.columns:
        local_fips = long_df["place"].fillna(long_df["county"])
    elif "place" in long_df.columns:
        local_fips = long_df["place"]
    else:
        local_fips = long_df["county"]
    long_df["geoid"] = long_df["state_fips"] + local_fips
    long_df = long_df[long_df["geoid"].isin(geography_lookup["geoid"])]  # keep only resolved geos

    # Split estimate vs. margin of error (variable codes end in E or M)
    long_df["is_moe"] = long_df["variable_code"].str.endswith("M")
    long_df["base_code"] = long_df["variable_code"].str.rstrip("EM")

    # Raw values are strings; coerce to numeric and null out Census's sentinel
    # codes (e.g. -666666666 = "sample too small to compute") so they don't
    # load as literal garbage values.
    numeric_value = pd.to_numeric(long_df["raw_value"], errors="coerce")
    long_df["raw_value"] = numeric_value.where(~numeric_value.isin(SENTINEL_CODES))

    # dropna=False: a geoid/variable whose estimate AND moe are both sentinel-
    # nulled (common -- suppressed estimates usually null out their MOE too)
    # should still load as an explicit NULL row, not silently vanish.
    pivoted = long_df.pivot_table(
        index=["geoid", "base_code"], columns="is_moe", values="raw_value", aggfunc="first", dropna=False
    ).reset_index()
    pivoted.columns = ["geoid", "variable_code", "estimate", "moe"]
    pivoted["year"] = year
    pivoted["table_id"] = table_id
    pivoted["variable_label"] = pivoted["variable_code"].map(
        lambda c: table_vars.get(c + "E", table_vars.get(c, c))
    )
    return pivoted[["geoid", "year", "table_id", "variable_code", "variable_label", "estimate", "moe"]]


def already_loaded(engine, table_id: str, year: int) -> bool:
    with engine.connect() as conn:
        result = conn.execute(
            text("SELECT 1 FROM acs_estimates WHERE table_id = :t AND year = :y LIMIT 1"),
            {"t": table_id, "y": year},
        )
        return result.first() is not None


def load_geography_table(engine, geography: pd.DataFrame):
    """acs_estimates.geoid has an FK to geography(geoid) -- every row here must
    exist there first, or every acs_estimates insert fails the FK constraint."""
    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM geography")).scalar()
    if count > 0:
        print(f"geography table already has {count} rows, skipping load")
        return
    geo = geography.copy()
    geo["is_ambiguous"] = geo["is_ambiguous"].map({"True": True, "False": False}).fillna(False)
    geo.to_sql("geography", engine, if_exists="append", index=False, method="multi")
    print(f"Loaded {len(geo)} geography rows")


def main():
    geography = pd.read_csv("geography_resolved.csv", dtype=str)
    state_fips_list = sorted(geography["geoid"].str[:2].unique())

    engine = create_engine(DATABASE_URL)
    load_geography_table(engine, geography)

    for table_id, dataset_suffix in TABLES.items():
        for year in YEARS:
            if already_loaded(engine, table_id, year):
                print(f"Skipping {table_id} for {year} (already loaded)")
                continue
            print(f"Pulling {table_id} for {year}...")
            raw_df, table_vars = pull_table_for_year(year, table_id, dataset_suffix, state_fips_list)
            if raw_df.empty:
                print(f"  no data returned, skipping")
                continue
            long_df = reshape_to_long(raw_df, table_vars, table_id, year, geography)
            long_df.to_sql("acs_estimates", engine, if_exists="append", index=False, method="multi")
            print(f"  loaded {len(long_df)} rows")


if __name__ == "__main__":
    main()
