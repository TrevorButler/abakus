"""
comparative_communities.py

Implements the Comparative Communities Assessor per "Guide to Abakus -
Structure, Sources and Transformations.pdf" (project root, pages 72-75).

Methodology: for a subject geography, rank every other geography of the
same geo_type (place vs. place, county vs. county -- never mixed) by sum
of squared difference (SSD) across three metrics:
    Total housing units (DP04_0001), Total households (S1101_C01_001),
    Median household income (S1901_C01_012)
Smaller SSD = more similar = better rank. The subject itself is excluded
from its own ranking (SSD=0 against itself would trivially "win").

State-level region filtering (state_filter) is an additive narrowing on
top of the existing 7-state scope -- pass the subject's own state to
restrict comparisons to same-state communities, or leave it None for the
full 7-state region (this project's version of the legacy tool's "All
States" option, which for that tool meant nationwide; here it already
means "all 7 in-scope states", which is itself the informal regional
relevance the PDF's author was hoping to formalize).

Candidates missing any of the three metrics for the requested year are
excluded from ranking entirely, rather than treated as a zero difference
-- silently imputing "missing = identical to subject" would artificially
inflate a candidate's similarity rank, which is worse than just leaving
it out.
"""

import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/census_dashboard")

HOUSING_UNITS_VAR = ("DP04", "DP04_0001")
HOUSEHOLDS_VAR = ("S1101", "S1101_C01_001")
MEDIAN_INCOME_VAR = ("S1901", "S1901_C01_012")


def get_engine():
    return create_engine(DATABASE_URL)


def find_comparative_communities(subject_geoid: str, year: int, *,
                                  state_filter: list = None, top_n: int = 100,
                                  engine=None) -> dict:
    """Returns the subject's own metrics plus a ranked list of the top_n most
    similar geographies (same geo_type as subject) by sum-of-squared-difference
    across housing units, households, and median household income.

    state_filter: list of state abbreviations to restrict candidates to
    (e.g. [subject's own state] for same-state-only), or None for the full
    in-scope region.
    """
    engine = engine or get_engine()

    with engine.connect() as conn:
        subject_row = conn.execute(
            text("SELECT geo_type, state_abbr, display_name FROM geography WHERE geoid = :geoid"),
            {"geoid": subject_geoid},
        ).first()
        if subject_row is None:
            raise ValueError(f"Unknown geoid: {subject_geoid}")
        geo_type = subject_row.geo_type

        query = text("""
            WITH metrics AS (
                SELECT geoid,
                    MAX(estimate) FILTER (WHERE table_id = 'DP04' AND variable_code = :hu_var) AS housing_units,
                    MAX(estimate) FILTER (WHERE table_id = 'S1101' AND variable_code = :hh_var) AS households,
                    MAX(estimate) FILTER (WHERE table_id = 'S1901' AND variable_code = :mi_var) AS median_income
                FROM acs_estimates
                WHERE year = :year
                  AND (table_id, variable_code) IN (
                      ('DP04', :hu_var), ('S1101', :hh_var), ('S1901', :mi_var)
                  )
                GROUP BY geoid
            ),
            subject AS (
                SELECT housing_units, households, median_income FROM metrics WHERE geoid = :subject_geoid
            )
            SELECT
                g.geoid, g.display_name, g.state_abbr,
                m.housing_units, m.households, m.median_income,
                POWER(m.housing_units - s.housing_units, 2)
                  + POWER(m.households - s.households, 2)
                  + POWER(m.median_income - s.median_income, 2) AS ssd
            FROM metrics m
            JOIN geography g ON g.geoid = m.geoid
            CROSS JOIN subject s
            WHERE g.geoid != :subject_geoid
              AND g.geo_type = :geo_type
              AND m.housing_units IS NOT NULL
              AND m.households IS NOT NULL
              AND m.median_income IS NOT NULL
              AND (:state_filter IS NULL OR g.state_abbr = ANY(:state_filter))
            ORDER BY ssd ASC
            LIMIT :top_n
        """)
        rows = conn.execute(query, {
            "hu_var": HOUSING_UNITS_VAR[1], "hh_var": HOUSEHOLDS_VAR[1], "mi_var": MEDIAN_INCOME_VAR[1],
            "year": year, "subject_geoid": subject_geoid, "geo_type": geo_type,
            "state_filter": state_filter, "top_n": top_n,
        })
        results = [
            {
                "rank": i + 1,
                "geoid": row.geoid,
                "display_name": row.display_name,
                "state_abbr": row.state_abbr,
                "housing_units": row.housing_units,
                "households": row.households,
                "median_income": row.median_income,
                "ssd": row.ssd,
            }
            for i, row in enumerate(rows)
        ]

        subject_metrics = conn.execute(
            text("""
                SELECT
                    MAX(estimate) FILTER (WHERE table_id = 'DP04' AND variable_code = :hu_var) AS housing_units,
                    MAX(estimate) FILTER (WHERE table_id = 'S1101' AND variable_code = :hh_var) AS households,
                    MAX(estimate) FILTER (WHERE table_id = 'S1901' AND variable_code = :mi_var) AS median_income
                FROM acs_estimates
                WHERE geoid = :subject_geoid AND year = :year
                  AND (table_id, variable_code) IN (
                      ('DP04', :hu_var), ('S1101', :hh_var), ('S1901', :mi_var)
                  )
            """),
            {"hu_var": HOUSING_UNITS_VAR[1], "hh_var": HOUSEHOLDS_VAR[1], "mi_var": MEDIAN_INCOME_VAR[1],
             "subject_geoid": subject_geoid, "year": year},
        ).first()

        candidate_pool_size = conn.execute(
            text("""
                SELECT COUNT(*) FROM geography g
                WHERE g.geo_type = :geo_type AND g.geoid != :subject_geoid
                  AND (:state_filter IS NULL OR g.state_abbr = ANY(:state_filter))
            """),
            {"geo_type": geo_type, "subject_geoid": subject_geoid, "state_filter": state_filter},
        ).scalar()

    return {
        "subject": {
            "geoid": subject_geoid,
            "display_name": subject_row.display_name,
            "geo_type": geo_type,
            "housing_units": subject_metrics.housing_units if subject_metrics else None,
            "households": subject_metrics.households if subject_metrics else None,
            "median_income": subject_metrics.median_income if subject_metrics else None,
        },
        "year": year,
        "state_filter": state_filter,
        "candidate_pool_size": candidate_pool_size,
        "results": results,
    }
