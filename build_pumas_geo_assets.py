"""
build_pumas_geo_assets.py

Converts the user-supplied PUMA/Shapefiles/Abakus_PUMA20.shp (2020 Census
PUMA boundaries, 490 features across the 7-state region, confirmed matching
the 2020-2024 5-year PUMS vintage's own PUMA20 boundary basis) into:

Every PUMA geoid is written as "P" + the raw 7-character GEOID20 (state
FIPS + PUMA code) -- empirically confirmed that the bare GEOID20 can
collide with an existing PLACE geoid (Census assigns place FIPS codes and
PUMA codes from unrelated namespaces, so a 7-char "state+5-digit-code"
string is not guaranteed unique across the two geo_types). The "P" prefix
is applied consistently here -- in the GeoJSON's GEOID property, the
centroids CSV, and the geography row load -- so every downstream consumer
(the map click handler, /geography/{geoid}, etl_pums_household_pull.py's
FK target) sees the same disambiguated id.

    1. geo_assets/pumas.geojson
       Same simplification approach as build_geo_assets.py (GEOS simplify +
       coordinate precision snapping), but written as its own function here
       rather than calling that script's simplify_layer() directly -- the
       PUMA shapefile's TIGER schema has no separate "NAME" field (only
       GEOID20/NAMELSAD20), unlike the place/county sources, so the column
       selection genuinely differs.

    2. geo_assets/puma_centroids.csv
       Kept deliberately separate from geo_assets/centroids.csv --
       build_geography_neighbors.py's gravity-model neighbor precompute has
       no PUMA use case, so PUMA centroids are never fed into that pipeline.

    3. A one-time load of all 490 PUMA rows into the geography table
       (geo_type='puma') -- must run before etl_pums_household_pull.py,
       which has an FK dependency on these rows existing.

Requires DATABASE_URL.
"""

import os

import geopandas as gpd
import pandas as pd
import shapely
from sqlalchemy import create_engine, text

from resolve_geography import STATE_ABBR_TO_NAME

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/census_dashboard")

SIMPLIFY_TOLERANCE = 0.0015  # degrees (~165m), matches build_geo_assets.py
PRECISION_GRID = 1e-5  # ~1.1m coordinate snapping, matches build_geo_assets.py

SOURCE_SHAPEFILE = "PUMA/Shapefiles/Abakus_PUMA20.shp"

STATE_FIPS_TO_ABBR = {"01": "AL", "12": "FL", "13": "GA", "37": "NC", "40": "OK", "45": "SC", "47": "TN"}


def main():
    raw = gpd.read_file(SOURCE_SHAPEFILE)
    print(f"{len(raw)} PUMA records read, CRS {raw.crs}")

    wgs84 = raw.to_crs(epsg=4326)
    simplified_geom = shapely.set_precision(
        wgs84.geometry.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True), grid_size=PRECISION_GRID
    )
    out = wgs84[["GEOID20", "NAMELSAD20"]].rename(columns={"GEOID20": "GEOID", "NAMELSAD20": "NAMELSAD"}).copy()
    out["GEOID"] = "P" + out["GEOID"]
    out["geometry"] = simplified_geom
    out_gdf = gpd.GeoDataFrame(out, geometry="geometry", crs="EPSG:4326")
    out_gdf.to_file("geo_assets/pumas.geojson", driver="GeoJSON")
    print("wrote geo_assets/pumas.geojson")

    centroids = pd.DataFrame({
        "geoid": "P" + raw["GEOID20"],
        "lat": raw["INTPTLAT20"].astype(float),
        "lon": raw["INTPTLON20"].astype(float),
    })
    centroids.to_csv("geo_assets/puma_centroids.csv", index=False)
    print(f"wrote geo_assets/puma_centroids.csv ({len(centroids)} rows)")

    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        existing = conn.execute(text("SELECT COUNT(*) FROM geography WHERE geo_type = 'puma'")).scalar()
    if existing > 0:
        print(f"geography already has {existing} puma rows, skipping load")
        return

    geo_rows = []
    for _, row in raw.iterrows():
        raw_geoid = row["GEOID20"]
        geoid = f"P{raw_geoid}"
        state_abbr = STATE_FIPS_TO_ABBR[raw_geoid[:2]]
        state_name = STATE_ABBR_TO_NAME[state_abbr]
        namelsad = row["NAMELSAD20"]
        geo_rows.append({
            "geoid": geoid,
            "geo_type": "puma",
            "name": namelsad,
            "name_lsad": namelsad,
            "display_name": f"{namelsad}, {state_name}",
            "state_abbr": state_abbr,
            "state_name": state_name,
            "county_geoid": None,
            "is_ambiguous": False,
            "acres": None,
        })

    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO geography (geoid, geo_type, name, name_lsad, display_name, state_abbr, state_name, county_geoid, is_ambiguous, acres)
                VALUES (:geoid, :geo_type, :name, :name_lsad, :display_name, :state_abbr, :state_name, :county_geoid, :is_ambiguous, :acres)
            """),
            geo_rows,
        )
    print(f"Loaded {len(geo_rows)} PUMA geography rows")


if __name__ == "__main__":
    main()
