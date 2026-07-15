"""
api.py

FastAPI layer wrapping the three calculation modules (demographics_dashboard,
housing_demand_projections, comparative_communities) plus geography search
and map asset serving. Local-dev only at this point -- no auth, no
deployment config. Run with:

    uvicorn api:app --reload

Interactive docs at http://127.0.0.1:8000/docs once running.
"""

from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

import comparative_communities as cc
import demographics_dashboard as dd
import housing_demand_projections as hdp

app = FastAPI(title="Abakus API", version="0.1.0")

# Wide open for local development -- tighten to the actual frontend origin
# once one exists and this moves toward deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/assets", StaticFiles(directory="geo_assets"), name="assets")

engine = dd.get_engine()

RateBasis = Literal["5yr", "10yr", "custom"]
TurnoverTier = Literal["static", "dampened", "standard", "elevated", "aggressive", "custom"]
DemandBasis = Literal["annual", "total"]


# ============================================================
# Geography
# ============================================================

@app.get("/geography/states")
def list_states():
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT DISTINCT state_abbr, state_name FROM geography ORDER BY state_name"))
        return [{"state_abbr": r.state_abbr, "state_name": r.state_name} for r in rows]


@app.get("/geography/search")
def search_geography(
    geo_type: Literal["place", "county"] = Query(...),
    state: Optional[str] = Query(None, description="2-letter state abbreviation"),
    q: Optional[str] = Query(None, description="Name search, case-insensitive substring match"),
    limit: int = Query(50, le=500),
):
    with engine.connect() as conn:
        sql = "SELECT geoid, name, name_lsad, display_name, state_abbr, county_geoid FROM geography WHERE geo_type = :geo_type"
        params = {"geo_type": geo_type, "limit": limit}
        if state:
            sql += " AND state_abbr = :state"
            params["state"] = state.upper()
        if q:
            sql += " AND name ILIKE :q"
            params["q"] = f"%{q}%"
        sql += " ORDER BY name LIMIT :limit"
        rows = conn.execute(text(sql), params)
        return [dict(r._mapping) for r in rows]


@app.get("/geography/{geoid}")
def get_geography(geoid: str):
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM geography WHERE geoid = :geoid"), {"geoid": geoid}).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Unknown geoid: {geoid}")
    return dict(row._mapping)


@app.get("/geography/{geoid}/neighbors")
def get_neighbors(geoid: str, radius_miles: float = Query(40.0, le=40.0)):
    with engine.connect() as conn:
        exists = conn.execute(text("SELECT 1 FROM geography WHERE geoid = :geoid"), {"geoid": geoid}).first()
        if exists is None:
            raise HTTPException(status_code=404, detail=f"Unknown geoid: {geoid}")
        rows = conn.execute(
            text("""
                SELECT g.geoid, g.display_name, g.geo_type, gn.centroid_distance_miles
                FROM geography_neighbors gn JOIN geography g ON g.geoid = gn.neighbor_geoid
                WHERE gn.subject_geoid = :geoid AND gn.centroid_distance_miles <= :radius
                ORDER BY gn.centroid_distance_miles
            """),
            {"geoid": geoid, "radius": radius_miles},
        )
        return [dict(r._mapping) for r in rows]


# ============================================================
# Demographics Dashboard
# ============================================================

# NB: registered before /dashboard/{geoid} -- FastAPI matches routes in
# registration order, and both patterns match a single path segment after
# /dashboard/, so /dashboard/region would otherwise be swallowed by the
# {geoid} route (with "region" treated as a literal geoid, 404ing).
@app.get("/dashboard/region")
def get_dashboard_region(
    geoids: str = Query(..., description="Comma-separated geoids to aggregate"),
    start_year: int = Query(2010, ge=2010, le=2024),
    end_year: int = Query(2024, ge=2010, le=2024),
):
    """Regional Analysis 'Aggregated' view: counts and category breakdowns
    summed across geoids; true medians omitted (see REGION_EXCLUDED_CHARTS --
    they can't be validly derived from constituent medians)."""
    geoid_list = [g.strip() for g in geoids.split(",") if g.strip()]
    if not geoid_list:
        raise HTTPException(status_code=400, detail="geoids must contain at least one geoid")
    if start_year > end_year:
        raise HTTPException(status_code=400, detail="start_year must be <= end_year")
    for g in geoid_list:
        _require_geography(g)
    result = dd.get_full_dashboard_region(geoid_list, start_year, end_year, engine=engine)
    return {"excluded_charts": sorted(dd.REGION_EXCLUDED_CHARTS), "charts": result}


@app.get("/dashboard/{geoid}")
def get_dashboard(
    geoid: str,
    start_year: int = Query(2010, ge=2010, le=2024),
    end_year: int = Query(2024, ge=2010, le=2024),
    charts: Optional[str] = Query(None, description="Comma-separated chart names; omit for all charts"),
):
    _require_geography(geoid)
    if start_year > end_year:
        raise HTTPException(status_code=400, detail="start_year must be <= end_year")

    if charts:
        names = [c.strip() for c in charts.split(",")]
        unknown = [n for n in names if n not in dd.CHART_FUNCTIONS]
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown chart(s): {unknown}. Valid: {sorted(dd.CHART_FUNCTIONS)}")
        return {name: dd.CHART_FUNCTIONS[name](engine, geoid, start_year, end_year) for name in names}

    return dd.get_full_dashboard(geoid, start_year, end_year, engine=engine)


@app.get("/dashboard/charts/list")
def list_charts():
    return sorted(dd.CHART_FUNCTIONS)


# ============================================================
# Housing Demand Projections
# ============================================================

@app.get("/housing-demand/{geoid}")
def get_housing_demand(
    geoid: str,
    base_year: int = Query(..., ge=2010, le=2024),
    target_year: int = Query(..., gt=2010),
    pop_rate_basis: RateBasis = "10yr",
    pop_custom_rate: Optional[float] = None,
    hh_size_rate_basis: RateBasis = "10yr",
    hh_size_custom_rate: Optional[float] = None,
    turnover_tier: TurnoverTier = "standard",
    turnover_custom_rate: Optional[float] = None,
    b19037_rate_basis: Optional[RateBasis] = "10yr",
    b19037_custom_rate: Optional[float] = None,
    b19037_demand_basis: DemandBasis = "annual",
):
    _require_geography(geoid)
    if target_year <= base_year:
        raise HTTPException(status_code=400, detail="target_year must be after base_year")
    for basis, custom, field in [
        (pop_rate_basis, pop_custom_rate, "pop_custom_rate"),
        (hh_size_rate_basis, hh_size_custom_rate, "hh_size_custom_rate"),
        (b19037_rate_basis, b19037_custom_rate, "b19037_custom_rate"),
    ]:
        if basis == "custom" and custom is None:
            raise HTTPException(status_code=400, detail=f"{field} is required when the matching rate_basis is 'custom'")
    if turnover_tier == "custom" and turnover_custom_rate is None:
        raise HTTPException(status_code=400, detail="turnover_custom_rate is required when turnover_tier is 'custom'")

    try:
        result = hdp.project_housing_demand(
            geoid, base_year, target_year,
            pop_rate_basis=pop_rate_basis, pop_custom_rate=pop_custom_rate,
            hh_size_rate_basis=hh_size_rate_basis, hh_size_custom_rate=hh_size_custom_rate,
            turnover_tier=turnover_tier, turnover_custom_rate=turnover_custom_rate,
            b19037_rate_basis=b19037_rate_basis, b19037_custom_rate=b19037_custom_rate,
            b19037_demand_basis=b19037_demand_basis,
            engine=engine,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # age_income_breakdown uses (age_group, income_bin) tuple keys -- fine for
    # Python-to-Python use, but JSON object keys must be strings. Reshape to a
    # list of records, which is also easier for a frontend to consume directly.
    if result["age_income_breakdown"] is not None:
        result["age_income_breakdown"] = [
            {"age_group": age_group, "income_bin": income_bin, "demand": demand}
            for (age_group, income_bin), demand in result["age_income_breakdown"].items()
        ]
    return result


@app.get("/housing-demand/assumptions/turnover-tiers")
def get_turnover_tiers():
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT key, label, value, notes FROM assumption_sets WHERE key LIKE 'turnover_%' ORDER BY value"))
        return [dict(r._mapping) for r in rows]


# ============================================================
# Comparative Communities Assessor
# ============================================================

@app.get("/comparative-communities/{geoid}")
def get_comparative_communities(
    geoid: str,
    year: int = Query(..., ge=2010, le=2024),
    state_filter: Optional[str] = Query(None, description="Comma-separated state abbreviations; omit for the full 7-state region"),
    top_n: int = Query(100, le=500),
):
    _require_geography(geoid)
    states = [s.strip().upper() for s in state_filter.split(",")] if state_filter else None
    return cc.find_comparative_communities(geoid, year, state_filter=states, top_n=top_n, engine=engine)


# ============================================================
# Shared helpers
# ============================================================

def _require_geography(geoid: str):
    with engine.connect() as conn:
        exists = conn.execute(text("SELECT 1 FROM geography WHERE geoid = :geoid"), {"geoid": geoid}).first()
    if exists is None:
        raise HTTPException(status_code=404, detail=f"Unknown geoid: {geoid}")
