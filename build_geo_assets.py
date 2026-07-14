"""
build_geo_assets.py

Converts the raw TIGER-resolution shapefiles in "Clean Shapefiles/" into two
deliverables:

    1. geo_assets/places.geojson, geo_assets/counties.geojson
       Simplified, WGS84, GEOID-keyed GeoJSON for client-side map rendering
       (MapLibre GL / Leaflet). Raw shapefiles are far too detailed for a web
       map (~3.8M vertices for places alone) so geometry is simplified with
       GeoPandas' GEOS-backed simplify() and coordinates are snapped to a
       ~1.1m precision grid to shrink JSON text size. This does per-polygon
       simplification (not shared-topology), so adjacent boundaries can show
       hairline gaps at high zoom -- acceptable for a selection map; revisit
       with mapshaper/topojson if pixel-perfect shared borders are ever needed.

    2. geo_assets/centroids.csv
       geoid, geo_type, lat, lon for every place and county. Reuses the
       Census-provided INTPTLAT/INTPTLON attribute fields rather than
       computing geometric centroids -- same field used earlier in this
       project for the ambiguous-place geocoding, and one less processing
       step. Feeds build_geography_neighbors.py.
"""

import geopandas as gpd
import pandas as pd
import shapely

SIMPLIFY_TOLERANCE = 0.0015  # degrees (~165m) -- balances file size vs shape fidelity
PRECISION_GRID = 1e-5  # ~1.1m coordinate snapping

SOURCES = {
    "places": "Clean Shapefiles/Abakus_Places.shp",
    "counties": "Clean Shapefiles/Abakus_Counties.shp",
}


def simplify_layer(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    simplified = gdf.geometry.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
    precise = shapely.set_precision(simplified, grid_size=PRECISION_GRID)
    out = gdf[["GEOID", "NAME", "NAMELSAD"]].copy()
    out["geometry"] = precise
    return gpd.GeoDataFrame(out, geometry="geometry", crs="EPSG:4326")


def main():
    centroid_rows = []

    for geo_type, path in SOURCES.items():
        raw = gpd.read_file(path)
        print(f"{geo_type}: {len(raw)} records, CRS {raw.crs}")

        wgs84 = raw.to_crs(epsg=4326)
        simplified = simplify_layer(wgs84)
        out_path = f"geo_assets/{geo_type}.geojson"
        simplified.to_file(out_path, driver="GeoJSON")
        print(f"  wrote {out_path}")

        for _, row in raw.iterrows():
            centroid_rows.append({
                "geoid": row["GEOID"],
                "geo_type": "county" if geo_type == "counties" else "place",
                "lat": float(row["INTPTLAT"]),
                "lon": float(row["INTPTLON"]),
            })

    centroids = pd.DataFrame(centroid_rows)
    centroids.to_csv("geo_assets/centroids.csv", index=False)
    print(f"wrote geo_assets/centroids.csv ({len(centroids)} rows)")


if __name__ == "__main__":
    main()
