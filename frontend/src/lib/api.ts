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
}

export type ChartResult = LineChart | StackedBarChart
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

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin)
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
}
