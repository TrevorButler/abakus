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
from typing import Literal, Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import text
from starlette.middleware.sessions import SessionMiddleware

import app_users
import auth
import comparative_communities as cc
import demographics_dashboard as dd
import housing_demand_projections as hdp

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
# Shared helpers
# ============================================================

def _require_geography(geoid: str):
    with engine.connect() as conn:
        exists = conn.execute(text("SELECT 1 FROM geography WHERE geoid = :geoid"), {"geoid": geoid}).first()
    if exists is None:
        raise HTTPException(status_code=404, detail=f"Unknown geoid: {geoid}")


# ============================================================
# Admin (allowlist management)
# ============================================================

class AddUserBody(BaseModel):
    email: str
    role: Literal["user", "admin"] = "user"


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
