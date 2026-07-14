"""
merge_reviewed_geography.py

Merges manually-confirmed rows from geography_needs_review.csv (a
"resolved_geoid" column filled in by hand, or by whatever means confirmed
the correct GEOID) back into geography_resolved.csv.

Run this after resolve_geography.py and after every row in
geography_needs_review.csv has a non-empty resolved_geoid. Rows with a
blank resolved_geoid are left in a fresh geography_still_needs_review.csv
so nothing silently gets dropped.
"""

import pandas as pd

from resolve_geography import load_gazetteer_counties, STATE_ABBR_TO_NAME

REVIEW_PATH = "geography_needs_review.csv"
RESOLVED_PATH = "geography_resolved.csv"


def merge():
    review = pd.read_csv(REVIEW_PATH, dtype=str)

    unresolved = review[review["resolved_geoid"].isna() | (review["resolved_geoid"].str.strip() == "")]
    if len(unresolved):
        unresolved.to_csv("geography_still_needs_review.csv", index=False)
        print(f"{len(unresolved)} rows still lack a resolved_geoid -> geography_still_needs_review.csv")
    review = review[~review.index.isin(unresolved.index)]

    if review.empty:
        print("Nothing to merge.")
        return

    county_geoid_map = (
        load_gazetteer_counties()
        .drop_duplicates(subset=["state_abbr", "namelsad"])
        .set_index(["state_abbr", "namelsad"])["geoid"]
    )

    new_rows = []
    for _, row in review.iterrows():
        new_rows.append({
            "geoid": row["resolved_geoid"],
            "geo_type": "place",
            "name": row["NAME"],
            "name_lsad": row["NAMELSAD"],
            "display_name": row["City Long"],
            "state_abbr": row["state_abbr"],
            "state_name": STATE_ABBR_TO_NAME[row["state_abbr"]],
            "county_geoid": county_geoid_map.get((row["state_abbr"], row["county_namelsad"])),
            "is_ambiguous": row["issue"] == "ambiguous name match",
        })

    new_df = pd.DataFrame(new_rows)
    resolved_df = pd.read_csv(RESOLVED_PATH, dtype=str)
    resolved_df["is_ambiguous"] = resolved_df["is_ambiguous"].map({"True": True, "False": False})

    combined = pd.concat([resolved_df, new_df], ignore_index=True)
    dupes = combined[combined["geoid"].duplicated(keep=False)]
    if len(dupes):
        raise SystemExit(f"Refusing to merge: duplicate geoid(s) introduced:\n{dupes}")

    combined.to_csv(RESOLVED_PATH, index=False)
    print(f"Merged {len(new_df)} rows -> {RESOLVED_PATH} ({len(combined)} total)")


if __name__ == "__main__":
    merge()
