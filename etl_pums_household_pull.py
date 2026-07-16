"""
etl_pums_household_pull.py

Pulls the 2020-2024 ACS 5-year PUMS household-record file for the 7-state
region and loads it into pums_households (schema_puma.sql). Only the
household-record variables are requested (no person-level vars like AGEP),
which is what makes the API return one row per household rather than per
person -- the person file isn't needed this phase (it was only for the
shelved "freestyle" module).

Requires DATABASE_URL and CENSUS_API_KEY (same key already used by
etl_acs_pull.py -- PUMS is a different dataset path on the same API, no
second key needed).

Empirically confirmed against a live pull before writing this:
  - "ST" is not a requestable variable name in this dataset -- the state
    FIPS comes back for free as a "state" column when the geography clause
    is `for=state:XX`.
  - SERIALNO prefix distinguishes housing-unit records ("...HU...") from
    group-quarters records ("...GQ..."); GQ records (and true vacant
    housing units) have WGTP=0 and TEN='0' -- filtered out here via
    `TEN not in ('0', '')`, since a "household" must be an occupied
    housing unit, not an institutional/vacant placeholder row.
  - ADJINC/ADJHSG are vintage-wide constants (same value on every record),
    stored as-is per-row per the Census PUMS convention (divide by 1e6 to
    apply), not specially handled here since no calculation this phase
    uses them yet.
"""

import os
import time

import pandas as pd
import requests
from sqlalchemy import create_engine, text

CENSUS_API_KEY = os.environ["CENSUS_API_KEY"]
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/census_dashboard")

VINTAGE = 2024  # 2020-2024 5-year PUMS, confirmed live as of 2026-07 (released March 2026)
STATE_FIPS = {"AL": "01", "FL": "12", "GA": "13", "NC": "37", "OK": "40", "SC": "45", "TN": "47"}

BASE_VARS = ["SERIALNO", "PUMA", "WGTP", "NP", "BLD", "BDSP", "NRC", "TEN", "HINCP", "ADJINC", "ADJHSG"]
REPLICATE_VARS = [f"WGTP{i}" for i in range(1, 81)]
# Batch A: base vars + WGTP1-38 (11 + 38 = 49, under the 50-var cap).
# Batch B: SERIALNO (join key) + WGTP39-80 (1 + 42 = 43).
BATCH_A_VARS = BASE_VARS + REPLICATE_VARS[:38]
BATCH_B_VARS = ["SERIALNO"] + REPLICATE_VARS[38:]

MAX_RETRIES = 3
CHUNK_SIZE = 5000  # per build_geography_neighbors.py's precedent for large to_sql loads


def _get_with_retries(url: str, params: dict) -> requests.Response:
    last_exc = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(url, params=params, timeout=120)
            resp.raise_for_status()
            return resp
        except requests.RequestException as e:
            last_exc = e
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
    raise last_exc


def fetch_batch(state_fips: str, var_codes: list) -> pd.DataFrame:
    url = f"https://api.census.gov/data/{VINTAGE}/acs/acs5/pums"
    params = {"get": ",".join(var_codes), "key": CENSUS_API_KEY, "for": f"state:{state_fips}"}
    resp = _get_with_retries(url, params)
    rows = resp.json()
    return pd.DataFrame(rows[1:], columns=rows[0])


def pull_state(state_fips: str) -> pd.DataFrame:
    batch_a = fetch_batch(state_fips, BATCH_A_VARS)
    batch_b = fetch_batch(state_fips, BATCH_B_VARS)
    # Batch B has no "state" column collision to worry about since it only
    # requests SERIALNO + replicate weights.
    merged = batch_a.merge(batch_b, on="SERIALNO", how="inner", validate="one_to_one")
    return merged


def already_loaded(engine, geoid_prefix: str) -> bool:
    with engine.connect() as conn:
        result = conn.execute(
            text("SELECT 1 FROM pums_households WHERE vintage = :v AND geoid LIKE :prefix LIMIT 1"),
            {"v": VINTAGE, "prefix": f"{geoid_prefix}%"},
        )
        return result.first() is not None


def reshape_for_load(raw: pd.DataFrame, state_fips: str) -> pd.DataFrame:
    occupied = raw[~raw["TEN"].isin(["0", ""])].copy()

    numeric_cols = ["WGTP", "NP", "BLD", "BDSP", "NRC", "TEN", "HINCP", "ADJINC", "ADJHSG"] + REPLICATE_VARS
    for col in numeric_cols:
        occupied[col] = pd.to_numeric(occupied[col], errors="coerce")

    out = pd.DataFrame({
        "serialno": occupied["SERIALNO"],
        "vintage": VINTAGE,
        "geoid": "P" + state_fips + occupied["PUMA"].astype(str).str.zfill(5),
        "wgtp": occupied["WGTP"].astype(int),
        "wgtp_replicates": occupied[REPLICATE_VARS].astype(int).values.tolist(),
        "np": occupied["NP"],
        "bld": occupied["BLD"],
        "bdsp": occupied["BDSP"],
        "nrc": occupied["NRC"],
        "ten": occupied["TEN"],
        "hincp": occupied["HINCP"],
        "adjinc": occupied["ADJINC"],
        "adjhsg": occupied["ADJHSG"],
    })
    return out


def load_state(engine, df: pd.DataFrame):
    records = df.to_dict(orient="records")
    with engine.begin() as conn:
        for i in range(0, len(records), CHUNK_SIZE):
            chunk = records[i:i + CHUNK_SIZE]
            conn.execute(
                text("""
                    INSERT INTO pums_households
                        (serialno, vintage, geoid, wgtp, wgtp_replicates, np, bld, bdsp, nrc, ten, hincp, adjinc, adjhsg)
                    VALUES
                        (:serialno, :vintage, :geoid, :wgtp, :wgtp_replicates, :np, :bld, :bdsp, :nrc, :ten, :hincp, :adjinc, :adjhsg)
                """),
                chunk,
            )


def main():
    engine = create_engine(DATABASE_URL)

    for state_abbr, state_fips in STATE_FIPS.items():
        geoid_prefix = f"P{state_fips}"
        if already_loaded(engine, geoid_prefix):
            print(f"Skipping {state_abbr} (already loaded)")
            continue

        print(f"Pulling {state_abbr}...")
        raw = pull_state(state_fips)
        print(f"  {len(raw)} total records fetched")

        loadable = reshape_for_load(raw, state_fips)
        print(f"  {len(loadable)} occupied-household records after filtering")

        load_state(engine, loadable)
        print(f"  loaded {len(loadable)} rows")


if __name__ == "__main__":
    main()
