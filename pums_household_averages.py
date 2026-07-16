"""
pums_household_averages.py

Weighted per-unit averages (household size, school-aged children) from PUMS
household microdata, by unit type and by bedroom count, for a single PUMA.
Corrects two methodological gaps in the legacy Excel tool this replaces:

    1. Naive unweighted averages -> proper WGTP-weighted means. An
       unweighted average across sampled households is not population-
       representative; PUMS requires weighting by the household weight to
       produce a valid statistic.
    2. No margin of error -> full 80-replicate-weight standard error, via
       the ACS "successive difference replication" (SDR) method: the same
       statistic is recomputed once per replicate weight (WGTP1..WGTP80),
       and SE = sqrt((4/80) * sum((estimate_r - estimate_0)^2)).

Deliberately plain Python (no numpy/pandas) -- at the row counts involved
(tens of thousands of households per PUMA), a single pass per weight column
(81 total: WGTP + 80 replicates), accumulating every needed statistic's
running sums simultaneously, is a few hundred ms worst case. Matches this
project's "production stays minimal" dependency convention; revisit only if
real latency or real per-PUMA row counts turn out materially worse than
expected.

Unit-type buckets (PUMS BLD variable): Mobile Home (1) and SFD (2) and
Townhome/SFA (3) each stand alone; Small Multiplex is 2-4 unit structures
(BLD 4-5, NOT folded into Multifamily -- "2 to 4 is still basically a
plex," per explicit direction); Multifamily is 5+ units only (BLD 6-9).
This is a genuine change from the legacy tool's blended "Multifamily"
definition. Bedroom-count breakdown (BDSP) applies across ALL unit types
by default, not just multifamily, per explicit direction -- an optional
bld_codes filter narrows it when a per-unit-type bedroom mix is wanted.
"""

import os

from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/census_dashboard")

UNIT_TYPE_BUCKETS = {
    "Mobile Home": [1],
    "Single-Family Detached": [2],
    "Townhome / Single-Family Attached": [3],
    "Small Multiplex (2-4 units)": [4, 5],
    "Multifamily (5+ units)": [6, 7, 8, 9],
}

BEDROOM_LABELS = {0: "Studio", 1: "1-Bedroom", 2: "2-Bedroom", 3: "3-Bedroom", 4: "4-Bedroom", 5: "5+ Bedroom"}

N_REPLICATES = 80


def get_engine():
    return create_engine(DATABASE_URL)


def fetch_households(engine, puma_geoid: str, bld_codes: list | None = None) -> list[dict]:
    """Raw household rows for one PUMA, optionally filtered to a BLD-code
    subset. Single PUMA only, this phase -- no region mode."""
    sql = "SELECT wgtp, wgtp_replicates, np, bld, bdsp, nrc FROM pums_households WHERE geoid = :geoid"
    params = {"geoid": puma_geoid}
    if bld_codes:
        sql += " AND bld = ANY(:bld_codes)"
        params["bld_codes"] = bld_codes
    with engine.connect() as conn:
        rows = conn.execute(text(sql), params)
        return [dict(r._mapping) for r in rows]


def weighted_mean(rows: list[dict], value_fn) -> float | None:
    """sum(wgtp * value_fn(row)) / sum(wgtp) -- fixes the legacy tool's
    naive unweighted average."""
    total_weight = 0.0
    total = 0.0
    for row in rows:
        v = value_fn(row)
        if v is None:
            continue
        w = row["wgtp"]
        total_weight += w
        total += w * v
    return total / total_weight if total_weight else None


def replicate_standard_error(rows: list[dict], value_fn) -> float | None:
    """ACS successive-difference-replication SE. Single pass accumulating
    the weighted numerator/denominator for WGTP (estimate_0) and each of
    the 80 replicate weights (estimate_1..80) simultaneously, rather than
    looping over rows once per replicate."""
    weight_totals = [0.0] * (N_REPLICATES + 1)
    weighted_sums = [0.0] * (N_REPLICATES + 1)

    for row in rows:
        v = value_fn(row)
        if v is None:
            continue
        weight_totals[0] += row["wgtp"]
        weighted_sums[0] += row["wgtp"] * v
        replicates = row["wgtp_replicates"]
        for r in range(N_REPLICATES):
            w = replicates[r]
            weight_totals[r + 1] += w
            weighted_sums[r + 1] += w * v

    if weight_totals[0] == 0:
        return None
    estimate_0 = weighted_sums[0] / weight_totals[0]

    sum_sq_diff = 0.0
    for r in range(1, N_REPLICATES + 1):
        if weight_totals[r] == 0:
            continue
        estimate_r = weighted_sums[r] / weight_totals[r]
        sum_sq_diff += (estimate_r - estimate_0) ** 2

    return (4.0 / N_REPLICATES * sum_sq_diff) ** 0.5


def _stat(rows: list[dict], value_fn) -> dict:
    return {
        "mean": weighted_mean(rows, value_fn),
        "se": replicate_standard_error(rows, value_fn),
        "n": len(rows),
    }


def average_household_size_by_unit_type(engine, puma_geoid: str) -> dict:
    """{unit_type_label: {mean, se, n}} -- average number of persons per
    household (PUMS NP), weighted, with a replicate-weight SE."""
    result = {}
    for label, bld_codes in UNIT_TYPE_BUCKETS.items():
        rows = fetch_households(engine, puma_geoid, bld_codes)
        result[label] = _stat(rows, lambda r: r["np"])
    return result


def average_school_children_by_unit_type(engine, puma_geoid: str) -> dict:
    """{unit_type_label: {mean, se, n}} -- average related children under
    18 per household (PUMS NRC), weighted. "School-aged" = under 18 as-is
    (confirmed scope; not narrowed to 5-17)."""
    result = {}
    for label, bld_codes in UNIT_TYPE_BUCKETS.items():
        rows = fetch_households(engine, puma_geoid, bld_codes)
        result[label] = _stat(rows, lambda r: r["nrc"])
    return result


def bedroom_distribution(engine, puma_geoid: str, bld_codes: list | None = None) -> dict:
    """WGTP-weighted share of households per bedroom-count bucket
    (Studio/1BR/.../5+BR). Defaults to ALL unit types combined; pass
    bld_codes to scope to one unit-type bucket instead."""
    rows = fetch_households(engine, puma_geoid, bld_codes)
    total_weight = sum(r["wgtp"] for r in rows)
    if not total_weight:
        return {}

    bucket_weights: dict[int, float] = {}
    for row in rows:
        bdsp = row["bdsp"]
        if bdsp is None:
            continue
        bucket = min(bdsp, 5)  # 5+ bedrooms collapse into one bucket
        bucket_weights[bucket] = bucket_weights.get(bucket, 0.0) + row["wgtp"]

    return {BEDROOM_LABELS.get(b, str(b)): w / total_weight for b, w in sorted(bucket_weights.items())}


def get_full_puma_summary(puma_geoid: str, engine=None) -> dict:
    engine = engine or get_engine()
    return {
        "household_size_by_unit_type": average_household_size_by_unit_type(engine, puma_geoid),
        "school_children_by_unit_type": average_school_children_by_unit_type(engine, puma_geoid),
        "bedroom_distribution": bedroom_distribution(engine, puma_geoid),
    }
