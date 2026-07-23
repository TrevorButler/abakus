"""
api.py

FastAPI layer wrapping the three calculation modules (demographics_dashboard,
housing_demand_projections, comparative_communities) plus geography search,
map asset serving, and Google-OAuth-gated access control (auth.py,
app_users.py). Run with:

    uvicorn api:app --reload

Interactive docs at http://127.0.0.1:8000/docs once running. Requires
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET, BACKEND_URL,
FRONTEND_URL set (see .env.example / render.yaml) -- there is no local-dev
bypass, since the OAuth roundtrip needs a real Google client.
"""

import os
import re
from io import BytesIO
from typing import Literal, Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import text
from starlette.middleware.sessions import SessionMiddleware

import app_users
import assumption_sets as asm
import auth
import bls_dashboard as bls
import bls_office_demand as bod
import comparative_communities as cc
import costar_heartbeat as ch
import costar_market_overview as cmo
import costar_multifamily_comps as cmc
import dashboard_excel_export as dex
import demographics_dashboard as dd
import housing_demand_projections as hdp
import master_export as mx
import pums_household_averages as pha
import smartre_sales as ss
from excel_export import workbook_to_bytes

app = FastAPI(title="Abakus API", version="0.1.0")

_is_production = os.environ.get("ENV") == "production"

# Session middleware must be added before CORS -- Starlette wraps
# middleware in reverse order of add_middleware calls (last added ends up
# outermost), so adding Session here and CORS below keeps CORS outermost,
# governing every response including /auth/callback's redirects. Cookie
# flags come from an explicit ENV literal (set in render.yaml, not a
# secret) rather than inferred from proxy headers, since Render terminates
# TLS in front of the app and forwards plain HTTP internally.
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ["SESSION_SECRET"],
    same_site="none" if _is_production else "lax",
    https_only=_is_production,
)

# Wide open (["*"]) was fine pre-auth, but browsers reject wildcard origins
# outright on credentialed (cookie-bearing) requests, so the local-dev
# fallback is now a concrete origin instead. FRONTEND_ORIGIN (comma-
# separated for more than one) must be set to the real deployed frontend
# origin(s) in production.
_frontend_origin = os.environ.get("FRONTEND_ORIGIN")
_allow_origins = [o.strip() for o in _frontend_origin.split(",")] if _frontend_origin else ["http://127.0.0.1:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/assets", StaticFiles(directory="geo_assets"), name="assets")

engine = dd.get_engine()

# require_user/require_admin close over the one shared engine above rather
# than each opening their own pool. data_router carries every existing
# data route so none can be missed; /auth/* stays on the bare app since
# requiring a session to reach /auth/login would be circular.
require_user = auth.make_require_user(engine)
require_admin = auth.make_require_admin(engine)
data_router = APIRouter(dependencies=[Depends(require_user)])

RateBasis = Literal["5yr", "10yr", "custom"]
TurnoverTier = Literal["static", "dampened", "standard", "elevated", "aggressive", "custom"]
DemandBasis = Literal["annual", "total"]
# Separate Literal from RateBasis above -- BLS office demand has a 4th option
# (custom_years) that ACS housing demand doesn't, so widening one can't
# accidentally affect the other's request validation.
BlsRateBasis = Literal["5yr", "10yr", "custom_rate", "custom_years"]


# ============================================================
# Geography
# ============================================================

@data_router.get("/geography/states")
def list_states():
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT DISTINCT state_abbr, state_name FROM geography ORDER BY state_name"))
        return [{"state_abbr": r.state_abbr, "state_name": r.state_name} for r in rows]


@data_router.get("/geography/search")
def search_geography(
    geo_type: Literal["place", "county", "puma"] = Query(...),
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


@data_router.get("/geography/{geoid}")
def get_geography(geoid: str):
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM geography WHERE geoid = :geoid"), {"geoid": geoid}).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Unknown geoid: {geoid}")
    return dict(row._mapping)


@data_router.get("/geography/{geoid}/neighbors")
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

# NB: registered before /dashboard/{geoid} -- same route-ordering
# precedence issue as /dashboard/region below (both are a single path
# segment after /dashboard/, so /dashboard/{geoid} would otherwise swallow
# this as a literal geoid "workbook").
@data_router.get("/dashboard/workbook")
def get_dashboard_workbook_multi(
    geoids: str = Query(..., description="Comma-separated geoids"),
    start_year: int = Query(2010, ge=2010, le=2024),
    end_year: int = Query(2024, ge=2010, le=2024),
    charts: Optional[str] = Query(None, description="Comma-separated chart names; omit for all charts"),
    view_mode: Literal["percent", "count"] = Query("percent", description="Category charts as percent shares or raw counts"),
):
    """Chart-bearing workbook for Comparative Analysis / Regional Analysis
    'Separated' -- one dashboard per geoid, re-run the same way
    MultiGeoDashboard.tsx already fetches them (N parallel calls to
    get_full_dashboard), just server-side instead of client-side fan-out."""
    geoid_list = [g.strip() for g in geoids.split(",") if g.strip()]
    if not geoid_list:
        raise HTTPException(status_code=400, detail="geoids must contain at least one geoid")
    if start_year > end_year:
        raise HTTPException(status_code=400, detail="start_year must be <= end_year")
    geo_labels = _geo_labels(geoid_list)
    dashboard_by_geoid = {
        g: _filter_dashboard(dd.get_full_dashboard(g, start_year, end_year, engine=engine), charts)
        for g in geoid_list
    }
    wb = dex.build_multi_geo_dashboard_workbook(dashboard_by_geoid, geo_labels, dex.acs_chart_title, view_mode)
    return _workbook_response(wb, "Comparison.xlsx")


# NB: registered before /dashboard/{geoid} -- FastAPI matches routes in
# registration order, and both patterns match a single path segment after
# /dashboard/, so /dashboard/region would otherwise be swallowed by the
# {geoid} route (with "region" treated as a literal geoid, 404ing).
@data_router.get("/dashboard/region")
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


@data_router.get("/dashboard/{geoid}")
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


# NB: registered before /dashboard/{geoid}/workbook -- same precedence
# issue as /dashboard/region vs /dashboard/{geoid} above.
@data_router.get("/dashboard/region/workbook")
def get_dashboard_region_workbook(
    geoids: str = Query(..., description="Comma-separated geoids to aggregate"),
    start_year: int = Query(2010, ge=2010, le=2024),
    end_year: int = Query(2024, ge=2010, le=2024),
    charts: Optional[str] = Query(None, description="Comma-separated chart names; omit for all charts"),
    view_mode: Literal["percent", "count"] = Query("percent", description="Category charts as percent shares or raw counts"),
):
    geoid_list = [g.strip() for g in geoids.split(",") if g.strip()]
    if not geoid_list:
        raise HTTPException(status_code=400, detail="geoids must contain at least one geoid")
    if start_year > end_year:
        raise HTTPException(status_code=400, detail="start_year must be <= end_year")
    for g in geoid_list:
        _require_geography(g)
    dashboard = _filter_dashboard(dd.get_full_dashboard_region(geoid_list, start_year, end_year, engine=engine), charts)
    wb = dex.build_dashboard_workbook(dashboard, dex.acs_chart_title, view_mode)
    return _workbook_response(wb, "Regional Analysis.xlsx")


@data_router.get("/dashboard/{geoid}/workbook")
def get_dashboard_workbook(
    geoid: str,
    start_year: int = Query(2010, ge=2010, le=2024),
    end_year: int = Query(2024, ge=2010, le=2024),
    charts: Optional[str] = Query(None, description="Comma-separated chart names; omit for all charts"),
    view_mode: Literal["percent", "count"] = Query("percent", description="Category charts as percent shares or raw counts"),
):
    _require_geography(geoid)
    if start_year > end_year:
        raise HTTPException(status_code=400, detail="start_year must be <= end_year")
    dashboard = _filter_dashboard(dd.get_full_dashboard(geoid, start_year, end_year, engine=engine), charts)
    wb = dex.build_dashboard_workbook(dashboard, dex.acs_chart_title, view_mode)
    return _workbook_response(wb, "Dashboard.xlsx")


@data_router.get("/dashboard/charts/list")
def list_charts():
    return sorted(dd.CHART_FUNCTIONS)


# ============================================================
# Housing Demand Projections
# ============================================================

def _run_housing_demand(geoid, base_year: int, target_year: int, pop_rate_basis: RateBasis, pop_custom_rate,
                         hh_size_rate_basis: RateBasis, hh_size_custom_rate, turnover_tier: TurnoverTier,
                         turnover_custom_rate, b19037_rate_basis: Optional[RateBasis], b19037_custom_rate,
                         b19037_demand_basis: DemandBasis):
    """Shared by the single-geoid and region routes -- geoid is either a
    str or a list of geoids, and every DB fetch beneath project_housing_demand()
    sums across geographies before any rate/percentage math runs (see
    housing_demand_projections.py), so this validation/response-shaping
    logic doesn't need to know which case it's in."""
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


# NB: registered before /housing-demand/{geoid} -- same route-ordering
# precedence issue as /dashboard/region vs /dashboard/{geoid}.
@data_router.get("/housing-demand/region")
def get_housing_demand_region(
    geoids: str = Query(..., description="Comma-separated geoids to aggregate"),
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
    geoid_list = [g.strip() for g in geoids.split(",") if g.strip()]
    if not geoid_list:
        raise HTTPException(status_code=400, detail="geoids must contain at least one geoid")
    for g in geoid_list:
        _require_geography(g)
    return _run_housing_demand(
        geoid_list, base_year, target_year, pop_rate_basis, pop_custom_rate, hh_size_rate_basis,
        hh_size_custom_rate, turnover_tier, turnover_custom_rate, b19037_rate_basis, b19037_custom_rate,
        b19037_demand_basis,
    )


@data_router.get("/housing-demand/{geoid}")
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
    return _run_housing_demand(
        geoid, base_year, target_year, pop_rate_basis, pop_custom_rate, hh_size_rate_basis,
        hh_size_custom_rate, turnover_tier, turnover_custom_rate, b19037_rate_basis, b19037_custom_rate,
        b19037_demand_basis,
    )


@data_router.get("/housing-demand/assumptions/turnover-tiers")
def get_turnover_tiers():
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT key, label, value, notes FROM assumption_sets WHERE key LIKE 'turnover_%' ORDER BY value"))
        return [dict(r._mapping) for r in rows]


# ============================================================
# Comparative Communities Assessor
# ============================================================

@data_router.get("/comparative-communities/{geoid}")
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
# BLS Employment & Wages
# ============================================================

def _parse_sectors(sectors: Optional[str]) -> list:
    if not sectors:
        return list(bls.NAICS_SECTORS.keys())
    codes = [c.strip() for c in sectors.split(",") if c.strip()]
    unknown = [c for c in codes if c not in bls.NAICS_SECTORS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown sector code(s): {unknown}. Valid: {sorted(bls.NAICS_SECTORS)}")
    return codes


# NB: registered before /bls/dashboard/{geoid} -- same route-ordering
# precedence issue as /dashboard/workbook vs /dashboard/{geoid} above.
@data_router.get("/bls/dashboard/workbook")
def get_bls_dashboard_workbook_multi(
    geoids: str = Query(..., description="Comma-separated county geoids"),
    start_year: int = Query(2010, ge=2010),
    end_year: int = Query(2024, ge=2010),
    sectors: Optional[str] = Query(None, description="Comma-separated NAICS sector codes; omit for all 20"),
    charts: Optional[str] = Query(None, description="Comma-separated chart names; omit for all charts"),
):
    geoid_list = [g.strip() for g in geoids.split(",") if g.strip()]
    if not geoid_list:
        raise HTTPException(status_code=400, detail="geoids must contain at least one geoid")
    if start_year > end_year:
        raise HTTPException(status_code=400, detail="start_year must be <= end_year")
    sector_list = _parse_sectors(sectors)
    geo_labels = _geo_labels(geoid_list)
    dashboard_by_geoid = {
        g: _filter_dashboard(bls.get_full_dashboard(g, start_year, end_year, sector_list, engine=engine), charts)
        for g in geoid_list
    }
    title_for = lambda k: dex.bls_chart_title(k, bls.NAICS_SECTORS)
    wb = dex.build_multi_geo_dashboard_workbook(dashboard_by_geoid, geo_labels, title_for)
    return _workbook_response(wb, "BLS Comparison.xlsx")


# NB: registered before /bls/dashboard/{geoid} -- same route-ordering
# precedence issue as /dashboard/region vs /dashboard/{geoid}.
@data_router.get("/bls/dashboard/region")
def get_bls_dashboard_region(
    geoids: str = Query(..., description="Comma-separated county geoids to aggregate"),
    start_year: int = Query(2010, ge=2010),
    end_year: int = Query(2024, ge=2010),
    sectors: Optional[str] = Query(None, description="Comma-separated NAICS sector codes; omit for all 20"),
):
    geoid_list = [g.strip() for g in geoids.split(",") if g.strip()]
    if not geoid_list:
        raise HTTPException(status_code=400, detail="geoids must contain at least one geoid")
    if start_year > end_year:
        raise HTTPException(status_code=400, detail="start_year must be <= end_year")
    for g in geoid_list:
        _require_geography(g)
    sector_list = _parse_sectors(sectors)
    return bls.get_full_dashboard_region(geoid_list, start_year, end_year, sector_list, engine=engine)


@data_router.get("/bls/dashboard/{geoid}")
def get_bls_dashboard(
    geoid: str,
    start_year: int = Query(2010, ge=2010),
    end_year: int = Query(2024, ge=2010),
    sectors: Optional[str] = Query(None, description="Comma-separated NAICS sector codes; omit for all 20"),
):
    _require_geography(geoid)
    if start_year > end_year:
        raise HTTPException(status_code=400, detail="start_year must be <= end_year")
    sector_list = _parse_sectors(sectors)
    return bls.get_full_dashboard(geoid, start_year, end_year, sector_list, engine=engine)


# NB: registered before /bls/dashboard/{geoid}/workbook -- same precedence
# issue as /bls/dashboard/region vs /bls/dashboard/{geoid} above.
@data_router.get("/bls/dashboard/region/workbook")
def get_bls_dashboard_region_workbook(
    geoids: str = Query(..., description="Comma-separated county geoids to aggregate"),
    start_year: int = Query(2010, ge=2010),
    end_year: int = Query(2024, ge=2010),
    sectors: Optional[str] = Query(None, description="Comma-separated NAICS sector codes; omit for all 20"),
    charts: Optional[str] = Query(None, description="Comma-separated chart names; omit for all charts"),
):
    geoid_list = [g.strip() for g in geoids.split(",") if g.strip()]
    if not geoid_list:
        raise HTTPException(status_code=400, detail="geoids must contain at least one geoid")
    if start_year > end_year:
        raise HTTPException(status_code=400, detail="start_year must be <= end_year")
    for g in geoid_list:
        _require_geography(g)
    sector_list = _parse_sectors(sectors)
    dashboard = _filter_dashboard(bls.get_full_dashboard_region(geoid_list, start_year, end_year, sector_list, engine=engine), charts)
    title_for = lambda k: dex.bls_chart_title(k, bls.NAICS_SECTORS)
    wb = dex.build_dashboard_workbook(dashboard, title_for)
    return _workbook_response(wb, "BLS Regional Analysis.xlsx")


@data_router.get("/bls/dashboard/{geoid}/workbook")
def get_bls_dashboard_workbook(
    geoid: str,
    start_year: int = Query(2010, ge=2010),
    end_year: int = Query(2024, ge=2010),
    sectors: Optional[str] = Query(None, description="Comma-separated NAICS sector codes; omit for all 20"),
    charts: Optional[str] = Query(None, description="Comma-separated chart names; omit for all charts"),
):
    _require_geography(geoid)
    if start_year > end_year:
        raise HTTPException(status_code=400, detail="start_year must be <= end_year")
    sector_list = _parse_sectors(sectors)
    dashboard = _filter_dashboard(bls.get_full_dashboard(geoid, start_year, end_year, sector_list, engine=engine), charts)
    title_for = lambda k: dex.bls_chart_title(k, bls.NAICS_SECTORS)
    wb = dex.build_dashboard_workbook(dashboard, title_for)
    return _workbook_response(wb, "BLS Dashboard.xlsx")


@data_router.get("/bls/dashboard/charts/list")
def list_bls_charts():
    return bls.list_charts()


@data_router.get("/bls/office-demand/assumptions")
def get_bls_office_assumptions():
    return asm.list_assumptions(engine, "bls_office_")


class SectorParam(BaseModel):
    naics_code: str
    enabled: bool = True
    rate_basis: BlsRateBasis = "10yr"
    custom_rate: Optional[float] = None
    custom_start_year: Optional[int] = None
    custom_end_year: Optional[int] = None


class OfficeDemandBody(BaseModel):
    base_year: int
    target_year: int
    sectors: list[SectorParam]


# JSON body (not GET+query-params) is deliberate here -- 7 sectors x 5 params
# each is unwieldy as a query string, and a JSON Content-Type forces a CORS
# preflight the same way AddUserBody's POST does below.
@data_router.post("/bls/office-demand/{geoid}")
def post_bls_office_demand(geoid: str, body: OfficeDemandBody):
    _require_geography(geoid)
    if body.target_year <= body.base_year:
        raise HTTPException(status_code=400, detail="target_year must be after base_year")

    enabled = [s for s in body.sectors if s.enabled]
    if not enabled:
        raise HTTPException(status_code=400, detail="at least one sector must be enabled")
    for s in enabled:
        if s.rate_basis == "custom_rate" and s.custom_rate is None:
            raise HTTPException(status_code=400, detail=f"custom_rate is required for sector {s.naics_code} when rate_basis is 'custom_rate'")
        if s.rate_basis == "custom_years":
            if s.custom_start_year is None or s.custom_end_year is None:
                raise HTTPException(status_code=400, detail=f"custom_start_year and custom_end_year are required for sector {s.naics_code} when rate_basis is 'custom_years'")
            if s.custom_start_year >= s.custom_end_year:
                raise HTTPException(status_code=400, detail=f"custom_start_year must be before custom_end_year for sector {s.naics_code}")

    sector_params = {
        s.naics_code: {
            "enabled": s.enabled, "rate_basis": s.rate_basis, "custom_rate": s.custom_rate,
            "custom_start_year": s.custom_start_year, "custom_end_year": s.custom_end_year,
        }
        for s in body.sectors
    }
    try:
        return bod.project_office_demand(geoid, body.base_year, body.target_year, sector_params, engine=engine)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================
# PUMA / PUMS
# ============================================================

@data_router.get("/pums/household-summary/{geoid}")
def get_pums_household_summary(geoid: str):
    row = _require_geography(geoid, return_row=True)
    if row["geo_type"] != "puma":
        raise HTTPException(status_code=400, detail=f"{geoid} is not a PUMA geoid")
    return pha.get_full_puma_summary(geoid, engine=engine)


# ============================================================
# CoStar / SmartRE (upload -> clean -> download, no DB)
# ============================================================

@data_router.post("/costar/heartbeat")
async def post_costar_heartbeat(file: UploadFile):
    content = await file.read()
    try:
        wb = ch.build_heartbeat_workbook(content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _workbook_response(wb, "Heartbeat.xlsx")


# market_{i}_name / market_{i}_{class} indexed fields (not a JSON body or a
# fixed set of UploadFile params) since the market count and which classes
# each market uploaded both vary per request -- form.get() returns either a
# plain string (name fields) or an UploadFile-like object (file fields).
@data_router.post("/costar/market-overview")
async def post_costar_market_overview(request: Request):
    form = await request.form()
    try:
        market_count = int(form.get("market_count", 0))
    except (TypeError, ValueError):
        market_count = 0
    if market_count == 0:
        raise HTTPException(status_code=400, detail="At least one market is required")

    markets = []
    for i in range(market_count):
        name = form.get(f"market_{i}_name")
        if not name:
            continue
        files = {}
        for cls in cmo.PROPERTY_CLASSES:
            upload = form.get(f"market_{i}_{cls}")
            if upload is not None and hasattr(upload, "read"):
                files[cls] = await upload.read()
        if files:
            markets.append({"name": name, "files": files})
    if not markets:
        raise HTTPException(status_code=400, detail="At least one market must have at least one uploaded file")

    try:
        wb = cmo.build_market_overview_workbook(markets)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _workbook_response(wb, "Market Overview.xlsx")


# Parallel "names"/"files" repeated fields (not indexed fields like Market
# Overview above) since every comp always has both parts -- no per-comp
# optionality to encode, so the simpler parallel-list form is enough.
@data_router.post("/costar/multifamily-comps")
async def post_costar_multifamily_comps(request: Request):
    form = await request.form()
    names = form.getlist("names")
    uploads = form.getlist("files")
    if not names or len(names) != len(uploads):
        raise HTTPException(status_code=400, detail="names and files must be provided in equal number")

    comps = []
    for name, upload in zip(names, uploads):
        if not hasattr(upload, "read"):
            continue
        comps.append({"name": name, "file_bytes": await upload.read()})
    if not comps:
        raise HTTPException(status_code=400, detail="At least one comp is required")

    try:
        wb = cmc.build_multifamily_comps_workbook(comps)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _workbook_response(wb, "Multifamily Comps.xlsx")


# Step 1 of the "Live Environment" flow: upload up to 20 files, get back
# the distinct subdivisions present so the user can pick a comp set before
# generation. Nothing is cached server-side -- step 2 re-sends the same
# files, consistent with every other CoStar/SmartRE module being fully
# stateless.
@data_router.post("/smartre/subdivisions")
async def post_smartre_subdivisions(request: Request):
    form = await request.form()
    uploads = form.getlist("files")
    files_bytes = [await u.read() for u in uploads if hasattr(u, "read")]
    if not files_bytes:
        raise HTTPException(status_code=400, detail="At least one file is required")
    try:
        subdivisions = ss.list_subdivisions(files_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"subdivisions": subdivisions}


@data_router.post("/smartre/sales-analysis")
async def post_smartre_sales_analysis(request: Request):
    form = await request.form()
    uploads = form.getlist("files")
    subdivisions = form.getlist("subdivisions")
    files_bytes = [await u.read() for u in uploads if hasattr(u, "read")]
    if not files_bytes:
        raise HTTPException(status_code=400, detail="At least one file is required")
    if not subdivisions:
        raise HTTPException(status_code=400, detail="At least one subdivision must be selected")
    try:
        wb = ss.build_sales_analysis_workbook(files_bytes, subdivisions)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _workbook_response(wb, "SmartRE Sales Analysis.xlsx")


# ============================================================
# Master Module (guided PPTX deck)
# ============================================================

# Stage 3 of the build order: single geography OR regional (aggregated-only
# -- no Separated option, confirmed with the user: the whole point of this
# deck is one coherent report, and per-geography detail is already covered
# by the not-yet-built Comparative section). ACS + BLS charts only --
# comparison section and CoStar/SmartRE uploads land in later stages per
# the plan. Multipart form (not a JSON body) since later stages add
# optional file uploads alongside these same scalar fields, and a request
# can't mix JSON with files in one body -- matches the
# costar_market_overview indexed-field convention from the start rather
# than switching shape later.
@data_router.post("/master/deck")
async def post_master_deck(request: Request):
    form = await request.form()
    place_type = form.get("place_type", "county")
    mode = form.get("mode", "single")
    if mode not in ("single", "regional"):
        raise HTTPException(status_code=400, detail="mode must be 'single' or 'regional'")

    geoids = form.get("geoids", "")
    geoid_list = [g.strip() for g in geoids.split(",") if g.strip()]
    if not geoid_list:
        raise HTTPException(status_code=400, detail="geoids must contain at least one geoid")
    if mode == "single" and len(geoid_list) != 1:
        raise HTTPException(status_code=400, detail="Single mode requires exactly one geoid")
    if mode == "regional" and len(geoid_list) > 50:
        raise HTTPException(status_code=400, detail="Regional mode supports at most 50 geoids")
    for g in geoid_list:
        geo_row = _require_geography(g, return_row=True)
        if geo_row["geo_type"] != place_type:
            raise HTTPException(status_code=400, detail=f"geoid {g} is not a {place_type}")

    try:
        start_year = int(form.get("start_year", 2010))
        end_year = int(form.get("end_year", 2024))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="start_year/end_year must be integers")
    if start_year > end_year:
        raise HTTPException(status_code=400, detail="start_year must be <= end_year")

    acs_charts = [c.strip() for c in (form.get("acs_charts") or "").split(",") if c.strip()]
    bls_charts = [c.strip() for c in (form.get("bls_charts") or "").split(",") if c.strip()]
    unknown_acs = [c for c in acs_charts if c not in dd.CHART_FUNCTIONS]
    if unknown_acs:
        raise HTTPException(status_code=400, detail=f"Unknown ACS chart(s): {unknown_acs}")

    # Comparative Analysis section (Stage 4) -- always a flat list of up to
    # 5 single geographies (not itself regional, even when the subject is),
    # mirroring the normal Comparative Analysis flow's own max-5 cap. The
    # chart-key selections here are entirely independent of acs_charts/
    # bls_charts above -- the user picks separately what belongs in this
    # section vs. the single-geography sections.
    comparison_geoids = [g.strip() for g in (form.get("comparison_geoids") or "").split(",") if g.strip()]
    if len(comparison_geoids) > 5:
        raise HTTPException(status_code=400, detail="Comparison supports at most 5 geographies")
    for g in comparison_geoids:
        geo_row = _require_geography(g, return_row=True)
        if geo_row["geo_type"] != place_type:
            raise HTTPException(status_code=400, detail=f"comparison geoid {g} is not a {place_type}")

    comparison_acs_charts = [c.strip() for c in (form.get("comparison_acs_charts") or "").split(",") if c.strip()]
    comparison_bls_charts = [c.strip() for c in (form.get("comparison_bls_charts") or "").split(",") if c.strip()]
    unknown_comp_acs = [c for c in comparison_acs_charts if c not in dd.CHART_FUNCTIONS]
    if unknown_comp_acs:
        raise HTTPException(status_code=400, detail=f"Unknown comparison ACS chart(s): {unknown_comp_acs}")

    geo_labels = _geo_labels(geoid_list)
    geo_label = geo_labels.get(geoid_list[0], geoid_list[0]) if mode == "single" else _region_label(geoid_list, geo_labels)

    need_acs = bool(acs_charts) or bool(comparison_acs_charts)
    acs_dashboard = {}
    if need_acs:
        if mode == "single":
            acs_dashboard = dd.get_full_dashboard(geoid_list[0], start_year, end_year, engine=engine)
        else:
            acs_dashboard = dd.get_full_dashboard_region(geoid_list, start_year, end_year, engine=engine)

    # Sectors span BOTH selections so a sector picked only in the
    # comparison picker still gets fetched for the subject too (needed
    # since the Comparative section reuses this same subject dashboard).
    need_bls = bool(bls_charts) or bool(comparison_bls_charts)
    bls_dashboard = {}
    sectors = []
    bls_start_year = start_year
    if need_bls:
        bls_start_year = bls.clamp_start_year(start_year)
        sectors = _sectors_from_bls_charts(bls_charts + comparison_bls_charts)
        bls_geoid_map = _resolve_bls_geoids(geoid_list, place_type)
        bls_geoids = sorted(set(bls_geoid_map.values()))
        if bls_geoids:
            if mode == "single":
                bls_dashboard = bls.get_full_dashboard(bls_geoids[0], bls_start_year, end_year, sectors, engine=engine)
            else:
                bls_dashboard = bls.get_full_dashboard_region(bls_geoids, bls_start_year, end_year, sectors, engine=engine)

    comparisons = []
    comparison_costar = []
    if comparison_geoids:
        comp_labels = _geo_labels(comparison_geoids)
        comp_bls_map = _resolve_bls_geoids(comparison_geoids, place_type) if need_bls else {}
        for g in comparison_geoids:
            comp_acs = dd.get_full_dashboard(g, start_year, end_year, engine=engine) if comparison_acs_charts else {}
            comp_bls_geoid = comp_bls_map.get(g)
            comp_bls = (
                bls.get_full_dashboard(comp_bls_geoid, bls_start_year, end_year, sectors, engine=engine)
                if comparison_bls_charts and comp_bls_geoid
                else {}
            )
            comparisons.append((comp_labels.get(g, g), comp_acs, comp_bls))

        # Per-comparison-geo CoStar repeater (Stage 6) -- same Heartbeat/
        # Market Overview shape as the subject's own upload below, just
        # "comparison_{geoid}_"-prefixed since each comparison geography
        # gets its own independent, optional upload.
        for g in comparison_geoids:
            g_heartbeat_upload = form.get(f"comparison_{g}_costar_properties")
            g_heartbeat_bytes = (
                await g_heartbeat_upload.read() if (g_heartbeat_upload is not None and hasattr(g_heartbeat_upload, "read")) else None
            )
            try:
                g_market_count = int(form.get(f"comparison_{g}_market_count", 0))
            except (TypeError, ValueError):
                g_market_count = 0
            g_markets = []
            for i in range(g_market_count):
                name = form.get(f"comparison_{g}_market_{i}_name")
                if not name:
                    continue
                files = {}
                for cls in cmo.PROPERTY_CLASSES:
                    upload = form.get(f"comparison_{g}_market_{i}_{cls}")
                    if upload is not None and hasattr(upload, "read"):
                        files[cls] = await upload.read()
                if files:
                    g_markets.append({"name": name, "files": files})
            if g_heartbeat_bytes or g_markets:
                try:
                    g_heartbeat_rows = ch.parse_properties(g_heartbeat_bytes) if g_heartbeat_bytes else None
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e))
                comparison_costar.append((comp_labels.get(g, g), g_heartbeat_rows, g_markets))

    # Subject-only CoStar uploads (Stage 5) -- Heartbeat (one file) and
    # Market Overview (up to 6 named markets, each with up to 5 optional
    # per-class files), same field-naming convention as the standalone
    # /costar/market-overview route but "subject_"-prefixed to distinguish
    # from the comparison-geo repeater above.
    heartbeat_upload = form.get("subject_costar_properties")
    heartbeat_bytes = await heartbeat_upload.read() if (heartbeat_upload is not None and hasattr(heartbeat_upload, "read")) else None

    try:
        subject_market_count = int(form.get("subject_market_count", 0))
    except (TypeError, ValueError):
        subject_market_count = 0
    market_overview_markets = []
    for i in range(subject_market_count):
        name = form.get(f"subject_market_{i}_name")
        if not name:
            continue
        files = {}
        for cls in cmo.PROPERTY_CLASSES:
            upload = form.get(f"subject_market_{i}_{cls}")
            if upload is not None and hasattr(upload, "read"):
                files[cls] = await upload.read()
        if files:
            market_overview_markets.append({"name": name, "files": files})

    # Subject-only SmartRE upload (Stage 6) -- same two-part shape as
    # /smartre/sales-analysis (repeated files + repeated subdivisions),
    # "subject_"-prefixed. Filtered to the selected subdivisions here
    # (mirrors build_sales_analysis_workbook's own filtering) so
    # master_export.py only ever sees already-scoped rows.
    smartre_uploads = form.getlist("subject_smartre_files")
    smartre_subdivisions = form.getlist("subject_smartre_subdivisions")
    smartre_rows = None
    if smartre_uploads and smartre_subdivisions:
        try:
            smartre_bytes = [await u.read() for u in smartre_uploads if hasattr(u, "read")]
            selected_subdivisions = set(smartre_subdivisions)
            all_smartre_rows = []
            for fb in smartre_bytes:
                all_smartre_rows.extend(ss.parse_sales_file(fb))
            smartre_rows = [r for r in all_smartre_rows if r["subdivision"] in selected_subdivisions]
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # User-typed report name (optional) -- printed on the title slide in
    # place of geo_label; the download filename still prefers it too, same
    # fallback-to-geo_label behavior as the title slide itself.
    report_title = (form.get("report_title") or "").strip() or None

    try:
        heartbeat_rows = ch.parse_properties(heartbeat_bytes) if heartbeat_bytes else None
        prs = mx.build_master_deck(
            geo_label, acs_dashboard, bls_dashboard, acs_charts, bls_charts,
            comparisons=comparisons, comparison_acs=comparison_acs_charts, comparison_bls=comparison_bls_charts,
            heartbeat_rows=heartbeat_rows, market_overview_markets=market_overview_markets,
            smartre_rows=smartre_rows, comparison_costar=comparison_costar,
            report_title=report_title,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _deck_response(prs, f"{report_title or geo_label}.pptx")


# ============================================================
# Shared helpers
# ============================================================

def _workbook_response(wb, filename: str) -> StreamingResponse:
    return StreamingResponse(
        BytesIO(workbook_to_bytes(wb)),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

def _require_geography(geoid: str, return_row: bool = False):
    with engine.connect() as conn:
        if return_row:
            row = conn.execute(text("SELECT geo_type FROM geography WHERE geoid = :geoid"), {"geoid": geoid}).first()
        else:
            row = conn.execute(text("SELECT 1 FROM geography WHERE geoid = :geoid"), {"geoid": geoid}).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Unknown geoid: {geoid}")
    if return_row:
        return dict(row._mapping)


def _filter_dashboard(dashboard: dict, charts: Optional[str]) -> dict:
    """Applies the same optional 'charts' selection every workbook route
    accepts (mirrors /dashboard/{geoid}'s existing charts= filter) --
    DownloadWorkbookButton's checklist UX needs to be able to request a
    subset without the backend re-deriving anything, so this just filters
    the already-fetched dashboard dict rather than re-querying selectively.
    Valid names are the dashboard's own keys, not a separately-passed
    static list -- a region dashboard's keys already exclude the 4 true-
    median charts, and BLS's per-sector trend keys are dynamic, so the
    dashboard itself is the only reliable source of what's actually valid
    for this particular request."""
    if not charts:
        return dashboard
    names = [c.strip() for c in charts.split(",")]
    unknown = [n for n in names if n not in dashboard]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown chart(s): {unknown}")
    return {name: dashboard[name] for name in names}


def _geo_labels(geoid_list: list) -> dict:
    """{geoid: display_name} for a multi-geoid workbook's sheet/chart
    labels -- falls back to the raw geoid for any geoid missing a row
    (shouldn't happen since every caller already validated the geoids, but
    a label always beats a KeyError)."""
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT geoid, display_name FROM geography WHERE geoid = ANY(:geoids)"), {"geoids": geoid_list})
        return {r.geoid: r.display_name for r in rows}


def _resolve_bls_geoids(geoid_list: list, place_type: str) -> dict:
    """BLS/QCEW is only published at county granularity -- when the
    master module's subject/comparison geography is a place, this
    resolves each place to its containing county for BLS purposes only
    (ACS keeps the original place geoid throughout). Returns
    {original_geoid: county_geoid} -- geography.county_geoid is already
    populated for every place row (NULL for county rows), so no schema
    change was needed. A dict (not a deduped list) preserves per-geoid
    identity: the subject/region fetch dedupes via set(mapping.values())
    since it sums across counties either way, but a comparison entry
    needs to know which county belongs to *it specifically*, not a pooled
    set shared with every other comparison entry."""
    if place_type != "place":
        return {g: g for g in geoid_list}
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT geoid, county_geoid FROM geography WHERE geoid = ANY(:geoids) AND county_geoid IS NOT NULL"),
            {"geoids": geoid_list},
        )
        return {r.geoid: r.county_geoid for r in rows}


_BLS_SECTOR_KEY_RE = re.compile(r"^(?:employment|wage|avg_pay)_trend_([\w-]+)$")


def _sectors_from_bls_charts(bls_charts: list) -> list:
    """Derives which NAICS sectors need querying from the selected BLS
    chart keys themselves, rather than taking a separate sectors= field --
    a per-sector trend chart (e.g. employment_trend_23) being selected is
    already an unambiguous statement of which sector it needs. The 4 fixed
    keys (employment_by_sector, avg_pay_by_sector, total_*) don't reference
    a specific sector, so they don't contribute here; get_full_dashboard
    handles an empty sectors list fine (those 4 keys don't depend on it)."""
    codes = {m.group(1) for key in bls_charts if (m := _BLS_SECTOR_KEY_RE.match(key))}
    return sorted(codes)


def _region_label(geoid_list: list, geo_labels: dict) -> str:
    """Cover-slide/filename label for a regional master-module deck --
    named geographies when there are few enough to read comfortably,
    otherwise a plain count (matches RegionalAnalysis.tsx's own "N
    geographies summed as one region" phrasing for the same tradeoff)."""
    names = [geo_labels.get(g, g) for g in geoid_list]
    if len(names) <= 3:
        return ", ".join(names)
    return f"{len(names)} Geographies (Region)"


def _deck_response(prs, filename: str) -> StreamingResponse:
    return StreamingResponse(
        BytesIO(mx.pptx_to_bytes(prs)),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ============================================================
# Admin (allowlist management)
# ============================================================

class AddUserBody(BaseModel):
    email: str
    role: Literal["user", "beta", "admin"] = "user"


# JSON body (not query params or form data) on the POST route is deliberate:
# a JSON Content-Type forces a CORS preflight, which the origin allowlist
# above blocks for any non-frontend origin. Form-encoded/query-string
# mutations bypass CORS preflight entirely via a bare <form> on a
# malicious page, since form submissions aren't subject to it -- DELETE is
# naturally safe either way, since DELETE always preflights.
admin_router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])


@admin_router.get("/users")
def list_app_users():
    return app_users.list_users(engine)


@admin_router.post("/users")
def add_app_user(body: AddUserBody, current_user: dict = Depends(require_admin)):
    return app_users.add_user(engine, body.email, body.role, added_by=current_user["email"])


@admin_router.delete("/users/{email}")
def delete_app_user(email: str):
    try:
        app_users.delete_user(engine, email)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"deleted": email}


class AssumptionBody(BaseModel):
    label: str
    value: float
    notes: Optional[str] = None


@admin_router.get("/assumptions")
def list_admin_assumptions(key_prefix: Optional[str] = Query(None)):
    return asm.list_assumptions(engine, key_prefix)


@admin_router.put("/assumptions/{key}")
def upsert_admin_assumption(key: str, body: AssumptionBody):
    return asm.upsert_assumption(engine, key, body.label, body.value, body.notes)


@admin_router.delete("/assumptions/{key}")
def delete_admin_assumption(key: str):
    asm.delete_assumption(engine, key)
    return {"deleted": key}


app.include_router(data_router)
app.include_router(admin_router)
app.include_router(
    auth.build_auth_router(
        engine,
        google_client_id=os.environ["GOOGLE_CLIENT_ID"],
        google_client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        backend_url=os.environ["BACKEND_URL"],
        frontend_url=os.environ["FRONTEND_URL"],
    )
)
