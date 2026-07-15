// Typed client for the FastAPI backend. Vite proxies /api -> the local
// uvicorn server (see vite.config.ts), so no base URL needed here.

export type GeoType = 'place' | 'county'

export interface GeographySummary {
  geoid: string
  name: string
  name_lsad: string
  display_name: string
  state_abbr: string
  county_geoid: string | null
}

export interface StateOption {
  state_abbr: string
  state_name: string
}

export interface LineChart {
  chart_type: 'line'
  series: Record<string, number>
}

export interface StackedBarChart {
  chart_type: 'stacked_bar'
  categories: Record<string, Record<string, number>>
  raw_categories: Record<string, Record<string, number>>
}

// Same shape as StackedBarChart, but each category is its own bar rather
// than a slice of one 100% stack -- used for Year Built / Year Moved In,
// where the bins are the thing being compared, not parts of a whole.
export interface BarChart {
  chart_type: 'bar'
  categories: Record<string, Record<string, number>>
  raw_categories: Record<string, Record<string, number>>
}

export type ChartResult = LineChart | StackedBarChart | BarChart
export type DashboardResult = Record<string, ChartResult>

export interface ComparativeMatch {
  rank: number
  geoid: string
  display_name: string
  state_abbr: string
  housing_units: number
  households: number
  median_income: number
  ssd: number
}

export interface ComparativeResult {
  subject: {
    geoid: string
    display_name: string
    geo_type: GeoType
    housing_units: number | null
    households: number | null
    median_income: number | null
  }
  year: number
  state_filter: string[] | null
  candidate_pool_size: number
  results: ComparativeMatch[]
}

export type RateBasis = '5yr' | '10yr' | 'custom'
export type TurnoverTier = 'static' | 'dampened' | 'standard' | 'elevated' | 'aggressive' | 'custom'
export type DemandBasis = 'annual' | 'total'

export interface TurnoverTierOption {
  key: string
  label: string
  value: number
  notes: string | null
}

export interface AgeIncomeCell {
  age_group: string
  income_bin: string
  demand: number
}

export interface HousingDemandResult {
  geoid: string | string[]
  base_year: number
  target_year: number
  population_rate: number
  household_size_rate: number
  turnover_rate: number
  population_actual: Record<string, number>
  household_size_actual: Record<string, number>
  population_projected: Record<string, number>
  household_size_projected: Record<string, number>
  households: Record<string, number>
  net_household_change: number
  turnover_demand_by_year: Record<string, number>
  total_demand: number
  annual_demand: number
  age_income_breakdown: AgeIncomeCell[] | null
}

export interface HousingDemandParams {
  base_year: number
  target_year: number
  pop_rate_basis: RateBasis
  pop_custom_rate?: number
  hh_size_rate_basis: RateBasis
  hh_size_custom_rate?: number
  turnover_tier: TurnoverTier
  turnover_custom_rate?: number
  b19037_rate_basis: RateBasis
  b19037_custom_rate?: number
  b19037_demand_basis: DemandBasis
}

// In local dev, this stays "/api" and Vite's proxy (see vite.config.ts)
// rewrites it to the backend. In production the frontend and backend are
// separate deployed services with different origins, so VITE_API_URL (set
// at build time in the hosting platform's env vars) points straight at the
// backend's real URL instead.
const API_BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')

// GeographyMap loads static GeoJSON from the backend's /assets mount, not
// through the /api-prefixed JSON endpoints above -- same dev-vs-prod split
// as API_BASE (dev proxies /map-assets -> backend /assets; prod has no
// proxy at runtime, so it needs the backend's real origin directly).
export function mapAssetUrl(filename: string): string {
  const base = import.meta.env.VITE_API_URL
  return base ? `${base.replace(/\/$/, '')}/assets/${filename}` : `/map-assets/${filename}`
}

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
  }
  const res = await fetch(url.toString())
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `Request failed: ${res.status}`)
  }
  return res.json()
}

export const api = {
  listStates: () => get<StateOption[]>('/geography/states'),

  searchGeography: (params: { geo_type: GeoType; state?: string; q?: string; limit?: number }) =>
    get<GeographySummary[]>('/geography/search', params),

  getGeography: (geoid: string) => get<GeographySummary & { geo_type: GeoType; state_name: string }>(`/geography/${geoid}`),

  getDashboard: (geoid: string, params: { start_year: number; end_year: number; charts?: string }) =>
    get<DashboardResult>(`/dashboard/${geoid}`, params),

  getComparativeCommunities: (geoid: string, params: { year: number; state_filter?: string; top_n?: number }) =>
    get<ComparativeResult>(`/comparative-communities/${geoid}`, params),

  getDashboardRegion: (geoids: string[], params: { start_year: number; end_year: number }) =>
    get<{ excluded_charts: string[]; charts: DashboardResult }>('/dashboard/region', { ...params, geoids: geoids.join(',') }),

  getHousingDemand: (geoid: string, params: HousingDemandParams) =>
    get<HousingDemandResult>(`/housing-demand/${geoid}`, { ...params }),

  getHousingDemandRegion: (geoids: string[], params: HousingDemandParams) =>
    get<HousingDemandResult>('/housing-demand/region', { ...params, geoids: geoids.join(',') }),

  getTurnoverTiers: () => get<TurnoverTierOption[]>('/housing-demand/assumptions/turnover-tiers'),
}
