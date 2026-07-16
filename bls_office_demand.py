"""
bls_office_demand.py

Projects office-space square-footage demand from BLS QCEW sector employment
growth: county-level job growth (professional sectors + health care) is
projected forward, translated to square feet via admin-editable coefficients
(assumption_sets, 'bls_office_%' keys), then allocated down to individual
places within the county by each place's share of total in-county place
acreage (geography.acres, populated by build_place_acreage.py) -- confirmed
reading: 100% of the county's projected demand lands in some place, none is
left attributed to unincorporated county land, consistent with the "new
office construction only happens in amenitized places" assumption behind
this whole model.

Each sector gets its own independently-resolved growth rate -- "5yr"/"10yr"
mirror housing_demand_projections.resolve_rate()'s trailing-CAGR options;
"custom_rate" lets a user supply the annual rate directly; "custom_years" is
new here and not in the ACS housing-demand module: it computes a CAGR
between two ARBITRARY user-chosen years (not required to end at base_year),
letting one sector's rate dodge a COVID/plant-closure/relocation-distorted
trailing window without forcing every sector into the same lookback -- the
flexibility explicitly requested for this module.
"""

import os

from sqlalchemy import create_engine, text

import assumption_sets
import bls_dashboard

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/census_dashboard")


def get_engine():
    return create_engine(DATABASE_URL)


def resolve_rate_flexible(basis: str, custom_rate, custom_start_year, custom_end_year, series: dict, base_year: int):
    """basis in {"5yr","10yr","custom_rate","custom_years"}. Returns None if
    the requested window's endpoints aren't both present in `series` or the
    start value is zero -- caller must handle a None rate (sector gets
    dropped from the projection rather than silently treated as 0% growth)."""
    if basis == "custom_rate":
        return custom_rate
    if basis == "custom_years":
        if custom_start_year is None or custom_end_year is None or custom_start_year == custom_end_year:
            return None
        start_value = series.get(custom_start_year)
        end_value = series.get(custom_end_year)
        if start_value is None or end_value is None or start_value == 0:
            return None
        years = custom_end_year - custom_start_year
        return (end_value / start_value) ** (1 / years) - 1
    # "5yr" / "10yr" -- trailing CAGR ending at base_year, same logic as
    # housing_demand_projections.historic_cagr, duplicated locally rather
    # than cross-imported (each calculation module owns its own helpers,
    # same precedent as demographics_dashboard/housing_demand_projections/
    # comparative_communities never importing from one another).
    lookback_years = 5 if basis == "5yr" else 10
    start_year = base_year - lookback_years
    start_value = series.get(start_year)
    end_value = series.get(base_year)
    if start_value is None or end_value is None or start_value == 0:
        return None
    return (end_value / start_value) ** (1 / lookback_years) - 1


def load_office_assumptions(engine) -> dict:
    rows = assumption_sets.list_assumptions(engine, "bls_office_")
    return {r["key"]: float(r["value"]) for r in rows}


def project_sector_employment(engine, county_geoid, base_year: int, target_year: int, sector_params: dict) -> dict:
    """sector_params: {naics_code: {"enabled": bool, "rate_basis": str,
    "custom_rate": float|None, "custom_start_year": int|None, "custom_end_year": int|None}}.
    Returns {naics_code: {"base_employment", "rate", "projected_employment"}}
    for enabled sectors only (rate/projected_employment are None if the
    sector's chosen window can't be resolved from available data)."""
    enabled_codes = [code for code, p in sector_params.items() if p.get("enabled")]
    if not enabled_codes:
        return {}

    custom_years = [
        y for p in sector_params.values()
        for y in (p.get("custom_start_year"), p.get("custom_end_year"))
        if y is not None
    ]
    # A custom window can reach earlier OR later than base_year (e.g. a
    # sector's rate derived from a more recent window than the projection's
    # own base year) -- fetch must span every requested year, not just back
    # to base_year - 10.
    fetch_start = min([base_year - 10] + custom_years)
    fetch_end = max([base_year] + custom_years)

    data = bls_dashboard.fetch_sector_series(engine, county_geoid, enabled_codes, fetch_start, fetch_end)

    result = {}
    for code in enabled_codes:
        series = {y: v[code]["employment"] for y, v in data.items() if code in v}
        p = sector_params[code]
        rate = resolve_rate_flexible(p["rate_basis"], p.get("custom_rate"), p.get("custom_start_year"), p.get("custom_end_year"), series, base_year)
        base_employment = series.get(base_year)
        projected = base_employment * (1 + rate) ** (target_year - base_year) if (rate is not None and base_employment is not None) else None
        result[code] = {"base_employment": base_employment, "rate": rate, "projected_employment": projected}
    return result


def compute_sqft_demand(projected_employment: dict, assumptions: dict) -> dict:
    """Professional sectors: employment_delta * sqft_per_professional_employee
    * occupancy_share -> a single sqft figure. Healthcare (NAICS 62):
    employment_delta * sqft_per_medical_employee * {low, high} multiplier ->
    a RANGE, since two multipliers were given rather than one point estimate.
    Returns {naics_code: {...}, "_totals": {professional_sqft_demand,
    medical_sqft_demand_low, medical_sqft_demand_high}}."""
    sqft_per_prof = assumptions["bls_office_sqft_per_professional_employee"]
    occupancy = assumptions["bls_office_occupancy_share"]
    sqft_per_medical = assumptions["bls_office_sqft_per_medical_employee"]
    medical_low = assumptions["bls_office_medical_multiplier_low"]
    medical_high = assumptions["bls_office_medical_multiplier_high"]

    result = {}
    professional_total = 0.0
    medical_total_low = 0.0
    medical_total_high = 0.0

    for code, proj in projected_employment.items():
        if proj["projected_employment"] is None or proj["base_employment"] is None:
            continue
        delta = proj["projected_employment"] - proj["base_employment"]
        if code in bls_dashboard.HEALTHCARE_SECTOR:
            low = delta * sqft_per_medical * medical_low
            high = delta * sqft_per_medical * medical_high
            result[code] = {"employment_delta": delta, "sqft_demand_low": low, "sqft_demand_high": high}
            medical_total_low += low
            medical_total_high += high
        else:
            sqft = delta * sqft_per_prof * occupancy
            result[code] = {"employment_delta": delta, "sqft_demand": sqft}
            professional_total += sqft

    result["_totals"] = {
        "professional_sqft_demand": professional_total,
        "medical_sqft_demand_low": medical_total_low,
        "medical_sqft_demand_high": medical_total_high,
    }
    return result


def allocate_to_places(engine, county_geoid: str, county_demand_sqft: float) -> dict:
    """{place_geoid: {display_name, allocated_sqft}} -- weighted by
    place_acres / SUM(place_acres in that county). 100% of county_demand_sqft
    lands in some place (confirmed reading; no unincorporated-land share is
    left unallocated)."""
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT geoid, display_name, acres FROM geography WHERE county_geoid = :county AND geo_type = 'place' AND acres IS NOT NULL"),
            {"county": county_geoid},
        ).fetchall()
    total_acres = sum(float(r.acres) for r in rows)
    if not total_acres:
        return {}
    return {
        r.geoid: {"display_name": r.display_name, "allocated_sqft": county_demand_sqft * (float(r.acres) / total_acres)}
        for r in rows
    }


def project_office_demand(county_geoid: str, base_year: int, target_year: int, sector_params: dict, engine=None) -> dict:
    """Top-level entry point. Raises ValueError if county_geoid isn't a
    geo_type='county' geography -- office-demand's growth math is inherently
    county-level (QCEW is published at county granularity); a place geoid
    here is a caller error, not silently coerced."""
    engine = engine or get_engine()

    with engine.connect() as conn:
        geo_type = conn.execute(text("SELECT geo_type FROM geography WHERE geoid = :g"), {"g": county_geoid}).scalar()
    if geo_type != "county":
        raise ValueError(f"project_office_demand requires a county geoid; {county_geoid!r} has geo_type={geo_type!r}")

    projected = project_sector_employment(engine, county_geoid, base_year, target_year, sector_params)
    assumptions = load_office_assumptions(engine)
    sqft = compute_sqft_demand(projected, assumptions)
    totals = sqft.pop("_totals")

    return {
        "county_geoid": county_geoid,
        "base_year": base_year,
        "target_year": target_year,
        "sector_projections": projected,
        "sector_sqft_demand": sqft,
        "countywide_professional_sqft_demand": totals["professional_sqft_demand"],
        "countywide_medical_sqft_demand_low": totals["medical_sqft_demand_low"],
        "countywide_medical_sqft_demand_high": totals["medical_sqft_demand_high"],
        "professional_sqft_by_place": allocate_to_places(engine, county_geoid, totals["professional_sqft_demand"]),
        "medical_sqft_by_place_low": allocate_to_places(engine, county_geoid, totals["medical_sqft_demand_low"]),
        "medical_sqft_by_place_high": allocate_to_places(engine, county_geoid, totals["medical_sqft_demand_high"]),
    }
