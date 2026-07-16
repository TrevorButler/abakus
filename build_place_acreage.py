"""
build_place_acreage.py

Populates geography.acres for every place row, feeding the BLS Office Demand
module's county-to-place allocation (each place's share of total in-county
place acreage). Reads Clean Shapefiles/Abakus_Places.shp directly (not the
already-simplified geo_assets/places.geojson) since the raw TIGER shapefile
carries ALAND -- the Census Bureau's own official land-area measurement in
square meters, already excluding water area, which is a more authoritative
and simpler source than re-deriving area from simplified/reprojected
geometry.

Requires DATABASE_URL.
"""

import os

import geopandas as gpd
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/census_dashboard")
SQM_PER_ACRE = 4046.8564224

# A handful of well-known cities to sanity-check computed acreage against
# public figures before trusting the full run.
SPOT_CHECK_GEOIDS = {
    "1304000": "Atlanta city, GA (~53,700 acres expected)",
    "4771000": "Nashville-Davidson, TN (~331,300 acres expected, consolidated city-county)",
    "1245000": "Jacksonville city, FL (~552,400 acres expected, consolidated city-county)",
}


def main():
    gdf = gpd.read_file("Clean Shapefiles/Abakus_Places.shp")
    print(f"{len(gdf)} place records read")

    gdf["acres"] = gdf["ALAND"] / SQM_PER_ACRE

    print("Spot check:")
    for geoid, note in SPOT_CHECK_GEOIDS.items():
        row = gdf[gdf["GEOID"] == geoid]
        if row.empty:
            print(f"  {geoid}: not found in this shapefile ({note})")
            continue
        print(f"  {geoid} {row.iloc[0]['NAMELSAD']}: {row.iloc[0]['acres']:,.0f} acres -- {note}")

    engine = create_engine(DATABASE_URL)
    updated = 0
    with engine.begin() as conn:
        for _, row in gdf.iterrows():
            result = conn.execute(
                text("UPDATE geography SET acres = :acres WHERE geoid = :geoid AND geo_type = 'place'"),
                {"acres": float(row["acres"]), "geoid": row["GEOID"]},
            )
            updated += result.rowcount

    print(f"Updated {updated} geography rows")


if __name__ == "__main__":
    main()
