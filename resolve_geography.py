"""
resolve_geography.py

Resolves the hand-built City_County_Crosswalk.csv into FIPS-coded rows
matching the `geography` table in schema_v1.sql.

Source data: Census Gazetteer Files (2024 vintage), tab-delimited.
    Places:   https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip
    Counties: https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip

NOTE: I could not verify these exact filenames live (census.gov isn't reachable
from my sandbox). The naming convention has been stable across recent vintages
(e.g. 2023_Gaz_place_national.zip), but check the directory listing at
https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/
if this 404s, and adjust GAZETTEER_PLACE_URL / GAZETTEER_COUNTY_URL below.

Output:
    geography_resolved.csv   -- ready to load into the `geography` table
    geography_needs_review.csv -- the ~46 ambiguous same-name places; confirm
                                   the correct GEOID by hand, then merge back in
"""

import io
import zipfile
import requests
import pandas as pd

TARGET_STATES = {"AL", "FL", "GA", "NC", "OK", "SC", "TN"}

STATE_ABBR_TO_NAME = {
    "AL": "Alabama", "FL": "Florida", "GA": "Georgia", "NC": "North Carolina",
    "OK": "Oklahoma", "SC": "South Carolina", "TN": "Tennessee",
}
STATE_NAME_TO_ABBR = {v: k for k, v in STATE_ABBR_TO_NAME.items()}

# Suffix Census appends to a place's bare name to form NAMELSAD (e.g. "Vance" -> "Vance city").
# LSAD drifts between vintages (population crossing the town/city threshold, CDP redefinitions),
# so the hand-built crosswalk's NAMELSAD doesn't always match the current Gazetteer's.
PLACE_LSAD_SUFFIX = r"\s+(city|town|CDP|village|municipality|borough|corporation)$"

GAZETTEER_PLACE_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip"
GAZETTEER_COUNTY_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip"

CROSSWALK_PATH = "City_County_Crosswalk.csv"


def _download_gazetteer(url: str) -> pd.DataFrame:
    """Gazetteer files ship as a zip containing one tab-delimited .txt file."""
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        txt_name = [n for n in zf.namelist() if n.endswith(".txt")][0]
        with zf.open(txt_name) as f:
            df = pd.read_csv(f, sep="\t", dtype=str, encoding="latin-1")
    df.columns = [c.strip() for c in df.columns]
    return df


def load_gazetteer_places() -> pd.DataFrame:
    df = _download_gazetteer(GAZETTEER_PLACE_URL)
    # Standard Gazetteer place columns: USPS, GEOID, ANSICODE, NAME, ...
    df = df.rename(columns={"USPS": "state_abbr", "GEOID": "geoid", "NAME": "namelsad"})
    df["geoid"] = df["geoid"].str.strip()
    df = df[df["state_abbr"].isin(TARGET_STATES)]
    return df[["state_abbr", "geoid", "namelsad"]]


def load_gazetteer_counties() -> pd.DataFrame:
    df = _download_gazetteer(GAZETTEER_COUNTY_URL)
    df = df.rename(columns={"USPS": "state_abbr", "GEOID": "geoid", "NAME": "namelsad"})
    df["geoid"] = df["geoid"].str.strip()
    df = df[df["state_abbr"].isin(TARGET_STATES)]
    return df[["state_abbr", "geoid", "namelsad"]]


def load_crosswalk() -> pd.DataFrame:
    df = pd.read_csv(CROSSWALK_PATH)
    df["state_abbr"] = df["STATE_NAME"].map(STATE_NAME_TO_ABBR)
    # CountState is like "Cocke County, Tennessee" -- split off just the county name
    df["county_namelsad"] = df["CountState"].str.split(",").str[0].str.strip()
    return df


def resolve():
    print("Downloading Gazetteer place file...")
    gaz_places = load_gazetteer_places()
    print(f"  {len(gaz_places)} places loaded across target states")

    print("Downloading Gazetteer county file...")
    gaz_counties = load_gazetteer_counties()
    print(f"  {len(gaz_counties)} counties loaded across target states")

    crosswalk = load_crosswalk()
    print(f"Crosswalk has {len(crosswalk)} place rows")

    # --- Resolve counties first (small set, low collision risk) ---
    county_geoid_map = (
        gaz_counties.drop_duplicates(subset=["state_abbr", "namelsad"])
        .set_index(["state_abbr", "namelsad"])["geoid"]
    )

    # --- Resolve places ---
    # Try an exact NAMELSAD match first (most reliable when LSAD hasn't drifted).
    # Fall back to bare-name (LSAD suffix stripped) when that fails, since LSAD
    # designations (city/town/CDP) can change between the crosswalk's vintage and
    # the current Gazetteer -- see PLACE_LSAD_SUFFIX note above.
    place_matches_exact = gaz_places.groupby(["state_abbr", "namelsad"])["geoid"].apply(list)

    gaz_places = gaz_places.copy()
    gaz_places["bare_name"] = gaz_places["namelsad"].str.replace(PLACE_LSAD_SUFFIX, "", regex=True)
    place_matches_bare = gaz_places.groupby(["state_abbr", "bare_name"])["geoid"].apply(list)

    resolved_rows = []
    review_rows = []

    for _, row in crosswalk.iterrows():
        exact_key = (row["state_abbr"], row["NAMELSAD"])
        candidates = place_matches_exact.get(exact_key, [])
        if len(candidates) != 1:
            bare_key = (row["state_abbr"], row["NAME"].strip())
            candidates = place_matches_bare.get(bare_key, [])

        county_geoid = county_geoid_map.get((row["state_abbr"], row["county_namelsad"]))

        if len(candidates) == 1:
            resolved_rows.append({
                "geoid": candidates[0],
                "geo_type": "place",
                "name": row["NAME"],
                "name_lsad": row["NAMELSAD"],
                "display_name": row["City Long"],
                "state_abbr": row["state_abbr"],
                "state_name": row["STATE_NAME"],
                "county_geoid": county_geoid,
                "is_ambiguous": False,
            })
        elif len(candidates) == 0:
            review_rows.append({**row.to_dict(), "issue": "no Gazetteer match found", "candidates": None})
        else:
            # Multiple places share this name+state -- needs manual disambiguation
            review_rows.append({**row.to_dict(), "issue": "ambiguous name match", "candidates": candidates})

    # Add the counties themselves as their own geography rows
    for (state_abbr, namelsad), geoid in county_geoid_map.items():
        state_name = STATE_ABBR_TO_NAME[state_abbr]
        resolved_rows.append({
            "geoid": geoid,
            "geo_type": "county",
            "name": namelsad.replace(" County", ""),
            "name_lsad": namelsad,
            "display_name": f"{namelsad}, {state_name}",
            "state_abbr": state_abbr,
            "state_name": state_name,
            "county_geoid": None,
            "is_ambiguous": False,
        })

    resolved_df = pd.DataFrame(resolved_rows)
    review_df = pd.DataFrame(review_rows)

    resolved_df.to_csv("geography_resolved.csv", index=False)
    review_df.to_csv("geography_needs_review.csv", index=False)

    print(f"\nResolved: {len(resolved_df)} rows -> geography_resolved.csv")
    print(f"Needs manual review: {len(review_df)} rows -> geography_needs_review.csv")


if __name__ == "__main__":
    resolve()
