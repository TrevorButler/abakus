"""
housing_demand_projections.py

Implements the Housing Demand Projections module per "Guide to Abakus -
Structure, Sources and Transformations.pdf" (project root). See that PDF
for the full worked example this was reverse-engineered against.

Methodology (population/household-size CAGR projection):
    1. Population and Average Household Size each get their own 5yr/10yr
       historic CAGR, computed from actual ACS data. The caller picks a
       rate for each (the computed 5yr/10yr figure, or a custom value) --
       see `historic_cagr`.
    2. Households are NOT projected directly. Population and household
       size are each projected forward independently, then Households =
       Population / Household Size for future years -- this captures
       shifts in household composition (more small vs. large households)
       that a direct household growth rate would miss. Historical years
       use the actual reported S1101 household count, not a derived one.
    3. Internal turnover: each *projected* year's household count
       generates incremental demand via a turnover rate (Static/Dampened/
       Standard/Elevated/Aggressive tiers, or custom -- see
       TURNOVER_TIERS). This models demand from move-ins/move-outs among
       households already in the community, separate from net growth.
    4. Total demand over the period = (Households[target] -
       Households[base]) + sum of every intervening year's turnover
       demand. Annual demand = total / number of years.
    5. B19037 (median income by age of householder) becomes an [age group
       x income bin] breakdown of the total/annual demand figure, built
       as a proper joint distribution rather than four independent
       age-group tables each re-scaled to the full demand:
           - each age group's OWN share of demand gets its own 5yr/10yr/
             custom historic CAGR and gets projected forward, same as
             every income-within-age-group cell.
           - both layers (age-group shares, and income shares within each
             age group) are independently trended, so nothing guarantees
             they still sum to 100% after projection -- each is rescaled
             back to sum to 1 after projecting, which is what makes the
             final matrix sum to exactly the demand figure it's fed
             while still preserving each cell's own relative trend.
           - demand[age][income] = normalized_age_share[age] *
             normalized_income_share[age][income] * demand_total
       This lets the matrix answer "how is the age/income mix of demand
       itself shifting over time" while still tying out to the reported
       total -- see project discussion for why the naive per-age-group
       scaling (each column independently multiplied by the full demand
       figure) is not a valid joint distribution.
"""

import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/census_dashboard")

POPULATION_VAR = "DP05_0001"
HOUSEHOLDS_VAR = "S1101_C01_001"
AVG_HH_SIZE_VAR = "S1101_C01_002"

# "Expert Assumptions" turnover tiers -- exact values from the original
# Excel tool (Guide to Abakus PDF, Housing Demand Projections section).
TURNOVER_TIERS = {
    "static": 0.0000,
    "dampened": 0.0010,
    "standard": 0.0025,
    "elevated": 0.0065,
    "aggressive": 0.0100,
}


def get_engine():
    return create_engine(DATABASE_URL)


def fetch_series(engine, geoid: str, table_id: str, variable_code: str, start_year: int, end_year: int) -> dict:
    """Returns {year: estimate} for a single variable across a year range."""
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT year, estimate FROM acs_estimates
                WHERE geoid = :geoid AND table_id = :table_id AND variable_code = :var
                  AND year BETWEEN :start AND :end
            """),
            {"geoid": geoid, "table_id": table_id, "var": variable_code, "start": start_year, "end": end_year},
        )
        return {row.year: float(row.estimate) for row in rows if row.estimate is not None}


def historic_cagr(series: dict, end_year: int, lookback_years: int):
    """Compound annual growth rate over `lookback_years` ending at end_year.
    Returns None if either endpoint is missing or the series starts at zero
    (can't compute a meaningful growth rate off a zero base)."""
    start_year = end_year - lookback_years
    start_value = series.get(start_year)
    end_value = series.get(end_year)
    if start_value is None or end_value is None or start_value == 0:
        return None
    return (end_value / start_value) ** (1 / lookback_years) - 1


def project_forward(base_value: float, rate: float, base_year: int, target_year: int) -> dict:
    """Compounds base_value forward year-by-year from base_year to target_year (inclusive)."""
    return {y: base_value * (1 + rate) ** (y - base_year) for y in range(base_year, target_year + 1)}


def resolve_rate(basis: str, custom: float, series: dict, base_year: int):
    """basis is "5yr", "10yr", or "custom" (with custom supplying the rate directly)."""
    if basis == "custom":
        return custom
    return historic_cagr(series, base_year, 5 if basis == "5yr" else 10)


def project_population_and_households(engine, geoid: str, base_year: int, target_year: int,
                                       pop_rate: float, hh_size_rate: float) -> dict:
    """Projects population and household size forward, derives projected households
    for future years, and splices in actual reported households for historical years."""
    lookback = max(10, base_year - target_year, 0) or 10
    pop_series = fetch_series(engine, geoid, "DP05", POPULATION_VAR, base_year - 10, base_year)
    hh_size_series = fetch_series(engine, geoid, "S1101", AVG_HH_SIZE_VAR, base_year - 10, base_year)
    actual_households = fetch_series(engine, geoid, "S1101", HOUSEHOLDS_VAR, base_year - 10, base_year)

    if base_year not in pop_series or base_year not in hh_size_series:
        raise ValueError(f"Missing base-year DP05/S1101 data for {geoid} in {base_year}")

    population = project_forward(pop_series[base_year], pop_rate, base_year, target_year)
    hh_size = project_forward(hh_size_series[base_year], hh_size_rate, base_year, target_year)

    households = {y: v for y, v in actual_households.items() if y < base_year}
    for y in range(base_year, target_year + 1):
        if y in actual_households:
            households[y] = actual_households[y]
        else:
            households[y] = population[y] / hh_size[y]

    return {
        "population_actual": pop_series,
        "household_size_actual": hh_size_series,
        "population_projected": population,
        "household_size_projected": hh_size,
        "households": households,
    }


def compute_turnover_demand(households: dict, base_year: int, target_year: int, turnover_rate: float) -> dict:
    """Per-year incremental demand from existing-household turnover, for every
    year strictly after base_year through target_year."""
    return {
        y: households[y] * turnover_rate
        for y in range(base_year + 1, target_year + 1)
    }


def compute_total_demand(households: dict, base_year: int, target_year: int, turnover_rate: float) -> dict:
    net_change = households[target_year] - households[base_year]
    turnover_by_year = compute_turnover_demand(households, base_year, target_year, turnover_rate)
    total = net_change + sum(turnover_by_year.values())
    n_years = target_year - base_year
    return {
        "net_household_change": net_change,
        "turnover_demand_by_year": turnover_by_year,
        "total_demand": total,
        "annual_demand": total / n_years if n_years else 0.0,
    }


def _parse_b19037_label(label: str):
    """Returns ("leaf", age_group, income_bin) for an income-bin cell,
    ("subtotal", age_group, None) for an age-group subtotal row,
    ("grand_total", None, None) for the B19037_001 grand total, or None.

    Census started appending trailing colons to hierarchy segments in the
    2019 ACS5 vintage ("Total" -> "Total:", "...years" -> "...years:");
    older vintages omit them. Strip colons before comparing so parsing is
    stable across the full 2010-2024 range -- this drift isn't documented
    anywhere in the Abakus PDF's per-table change log, found empirically.
    """
    parts = [p.rstrip(":") for p in label.split("!!")]
    if len(parts) == 4 and parts[1] == "Total":
        return "leaf", parts[2], parts[3]
    if len(parts) == 3 and parts[1] == "Total" and parts[2] != "Total":
        return "subtotal", parts[2], None
    if len(parts) == 2 and parts[1] == "Total":
        return "grand_total", None, None
    return None


def _fetch_b19037_raw(engine, geoid: str, start_year: int, end_year: int) -> dict:
    """Returns (cells, subtotals, grand_totals):
        cells: {year: {(age_group, income_bin): value}}
        subtotals: {year: {age_group: value}}
        grand_totals: {year: value}
    """
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT year, variable_label, estimate FROM acs_estimates
                WHERE geoid = :geoid AND table_id = 'B19037' AND year BETWEEN :start AND :end
            """),
            {"geoid": geoid, "start": start_year, "end": end_year},
        )
        cells, subtotals, grand_totals = {}, {}, {}
        for row in rows:
            if row.estimate is None:
                continue
            parsed = _parse_b19037_label(row.variable_label)
            if parsed is None:
                continue
            kind, age_group, income_bin = parsed
            if kind == "leaf":
                cells.setdefault(row.year, {})[(age_group, income_bin)] = float(row.estimate)
            elif kind == "subtotal":
                subtotals.setdefault(row.year, {})[age_group] = float(row.estimate)
            else:
                grand_totals[row.year] = float(row.estimate)
    return cells, subtotals, grand_totals


def _project_share(series: dict, base_year: int, target_year: int, rate_basis: str, custom_rate):
    """Resolves a rate for `series` and projects its base_year value forward.
    Returns None if the rate can't be resolved (insufficient history)."""
    rate = resolve_rate(rate_basis, custom_rate, series, base_year)
    if rate is None or base_year not in series:
        return None
    return series[base_year] * (1 + rate) ** (target_year - base_year)


def compute_b19037_breakdown(engine, geoid: str, base_year: int, target_year: int,
                              rate_basis: str, custom_rate, demand_total: float) -> dict:
    """Returns {(age_group, income_bin): projected_demand_count}, a proper joint
    distribution over demand_total: each age group's own share of demand and each
    income bin's share within its age group are independently trended via their
    own historic CAGR, then each layer is rescaled to sum to 1 before combining --
    otherwise independent drift means neither layer reliably sums to 100% after
    projection, and the matrix wouldn't tie out to demand_total. rate_basis is
    "5yr", "10yr", or "custom" (custom_rate supplies the value for "custom")."""
    cells, subtotals, grand_totals = _fetch_b19037_raw(engine, geoid, base_year - 10, base_year)

    age_share_series = {}  # {age_group: {year: share_of_grand_total}}
    for year, year_subtotals in subtotals.items():
        grand_total = grand_totals.get(year)
        if not grand_total:
            continue
        for age_group, value in year_subtotals.items():
            age_share_series.setdefault(age_group, {})[year] = value / grand_total

    income_share_series = {}  # {(age_group, income_bin): {year: share_within_age_group}}
    for year, year_cells in cells.items():
        year_subtotals = subtotals.get(year, {})
        for (age_group, income_bin), value in year_cells.items():
            denom = year_subtotals.get(age_group)
            if not denom:
                continue
            income_share_series.setdefault((age_group, income_bin), {})[year] = value / denom

    projected_age_share = {}
    for age_group, series in age_share_series.items():
        projected = _project_share(series, base_year, target_year, rate_basis, custom_rate)
        if projected is not None:
            projected_age_share[age_group] = projected
    age_share_total = sum(projected_age_share.values())
    if not age_share_total:
        return {}
    normalized_age_share = {ag: v / age_share_total for ag, v in projected_age_share.items()}

    projected_income_share = {}
    for key, series in income_share_series.items():
        projected = _project_share(series, base_year, target_year, rate_basis, custom_rate)
        if projected is not None:
            projected_income_share[key] = projected

    income_share_total_by_age = {}
    for (age_group, income_bin), value in projected_income_share.items():
        income_share_total_by_age[age_group] = income_share_total_by_age.get(age_group, 0.0) + value

    breakdown = {}
    for (age_group, income_bin), value in projected_income_share.items():
        if age_group not in normalized_age_share:
            continue
        age_total = income_share_total_by_age.get(age_group)
        if not age_total:
            continue
        normalized_income_share = value / age_total
        breakdown[(age_group, income_bin)] = normalized_age_share[age_group] * normalized_income_share * demand_total

    return breakdown


def project_housing_demand(geoid: str, base_year: int, target_year: int, *,
                            pop_rate_basis: str, pop_custom_rate=None,
                            hh_size_rate_basis: str, hh_size_custom_rate=None,
                            turnover_tier: str, turnover_custom_rate=None,
                            b19037_rate_basis: str = None, b19037_custom_rate=None,
                            b19037_demand_basis: str = "annual",
                            engine=None) -> dict:
    """Top-level entry point. rate_basis params are "5yr", "10yr", or "custom".
    turnover_tier is a key in TURNOVER_TIERS, or "custom". b19037_demand_basis
    is "annual" or "total" -- which demand figure the age x income matrix sums to."""
    engine = engine or get_engine()

    pop_series = fetch_series(engine, geoid, "DP05", POPULATION_VAR, base_year - 10, base_year)
    hh_size_series = fetch_series(engine, geoid, "S1101", AVG_HH_SIZE_VAR, base_year - 10, base_year)

    pop_rate = resolve_rate(pop_rate_basis, pop_custom_rate, pop_series, base_year)
    hh_size_rate = resolve_rate(hh_size_rate_basis, hh_size_custom_rate, hh_size_series, base_year)
    if pop_rate is None or hh_size_rate is None:
        raise ValueError("Could not resolve population or household-size growth rate (insufficient history)")

    if turnover_tier == "custom":
        turnover_rate = turnover_custom_rate
    else:
        turnover_rate = TURNOVER_TIERS[turnover_tier]

    projection = project_population_and_households(engine, geoid, base_year, target_year, pop_rate, hh_size_rate)
    demand = compute_total_demand(projection["households"], base_year, target_year, turnover_rate)

    age_income_breakdown = None
    if b19037_rate_basis is not None:
        demand_total = demand["annual_demand"] if b19037_demand_basis == "annual" else demand["total_demand"]
        age_income_breakdown = compute_b19037_breakdown(
            engine, geoid, base_year, target_year,
            b19037_rate_basis, b19037_custom_rate, demand_total,
        )

    return {
        "geoid": geoid,
        "base_year": base_year,
        "target_year": target_year,
        "population_rate": pop_rate,
        "household_size_rate": hh_size_rate,
        "turnover_rate": turnover_rate,
        **projection,
        **demand,
        "age_income_breakdown": age_income_breakdown,
    }
