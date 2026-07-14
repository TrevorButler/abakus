"""
build_geography_neighbors.py

Computes the static geography_neighbors table for the gravity-model housing
demand projection: every pair of geographies (place or county, mixed freely)
whose Census internal-point centroids are within 40 miles of each other,
using centroid-to-centroid distance (not boundary intersection) per the
finalized spec.

Static / batch, not a live query -- rerun this on the same cadence as a
geography refresh (annually, or whenever geo_assets/centroids.csv changes),
not per-request. Requires geo_assets/centroids.csv (build_geo_assets.py).

Uses sklearn's BallTree with the haversine metric for an O(n log n) radius
query instead of an O(n^2) pairwise distance loop -- trivial at this scale
(~5,400 geographies) but avoids a naive double loop regardless.
"""

import os
import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/census_dashboard")
RADIUS_MILES = 40.0
EARTH_RADIUS_MILES = 3958.8


def main():
    centroids = pd.read_csv("geo_assets/centroids.csv", dtype={"geoid": str})
    geography = pd.read_csv("geography_resolved.csv", dtype=str)

    in_scope = centroids[centroids["geoid"].isin(geography["geoid"])].reset_index(drop=True)
    dropped = set(geography["geoid"]) - set(in_scope["geoid"])
    print(f"{len(in_scope)} / {len(geography)} geographies have a centroid "
          f"({len(dropped)} missing -- see build_geo_assets.py output, e.g. renamed/dissolved places)")

    coords_rad = np.radians(in_scope[["lat", "lon"]].to_numpy())
    tree = BallTree(coords_rad, metric="haversine")
    radius_rad = RADIUS_MILES / EARTH_RADIUS_MILES

    neighbor_idx, distances_rad = tree.query_radius(coords_rad, r=radius_rad, return_distance=True)

    rows = []
    for i, (neighbors, dists) in enumerate(zip(neighbor_idx, distances_rad)):
        subject_geoid = in_scope.loc[i, "geoid"]
        for j, d_rad in zip(neighbors, dists):
            if j == i:
                continue  # exclude self
            rows.append({
                "subject_geoid": subject_geoid,
                "neighbor_geoid": in_scope.loc[j, "geoid"],
                "centroid_distance_miles": d_rad * EARTH_RADIUS_MILES,
            })

    result = pd.DataFrame(rows)
    print(f"{len(result)} neighbor pairs within {RADIUS_MILES} miles "
          f"(avg {len(result) / len(in_scope):.1f} neighbors per geography)")

    engine = create_engine(DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE geography_neighbors"))
    result.to_sql("geography_neighbors", engine, if_exists="append", index=False, method="multi", chunksize=5000)
    print("loaded into geography_neighbors")


if __name__ == "__main__":
    main()
