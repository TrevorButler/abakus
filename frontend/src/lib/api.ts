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
}
