// Typed client for the FastAPI backend. Vite proxies /api -> the local
// uvicorn server (see vite.config.ts), so no base URL needed here.

import type { ChartViewMode } from './chartMeta'

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

export type UserRole = 'user' | 'beta' | 'admin'

export interface AuthUser {
  email: string
  role: UserRole
}

export interface AppUser {
  email: string
  role: UserRole
  added_by: string | null
  created_at: string
}

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

// All 20 real 2-digit NAICS sectors -- matches bls_dashboard.NAICS_SECTORS
// on the backend exactly. Used by the dashboard/comparative views, which
// show every sector (unlike Office Demand's narrower set below).
export const NAICS_SECTORS: { code: string; label: string }[] = [
  { code: '11', label: 'Agriculture, Forestry, Fishing and Hunting' },
  { code: '21', label: 'Mining, Quarrying, and Oil and Gas Extraction' },
  { code: '22', label: 'Utilities' },
  { code: '23', label: 'Construction' },
  { code: '31-33', label: 'Manufacturing' },
  { code: '42', label: 'Wholesale Trade' },
  { code: '44-45', label: 'Retail Trade' },
  { code: '48-49', label: 'Transportation and Warehousing' },
  { code: '51', label: 'Information' },
  { code: '52', label: 'Finance and Insurance' },
  { code: '53', label: 'Real Estate and Rental and Leasing' },
  { code: '54', label: 'Professional, Scientific, and Technical Services' },
  { code: '55', label: 'Management of Companies and Enterprises' },
  { code: '56', label: 'Administrative and Support and Waste Management and Remediation Services' },
  { code: '61', label: 'Educational Services' },
  { code: '62', label: 'Health Care and Social Assistance' },
  { code: '71', label: 'Arts, Entertainment, and Recreation' },
  { code: '72', label: 'Accommodation and Food Services' },
  { code: '81', label: 'Other Services (except Public Administration)' },
  { code: '92', label: 'Public Administration' },
]

// Office Demand's narrower 7-sector set (professional + healthcare) --
// matches bls_dashboard.ALL_SECTORS on the backend exactly. Kept separate
// from NAICS_SECTORS since the office-demand sqft coefficients only apply
// to these sectors, not all 20.
export const OFFICE_DEMAND_SECTORS: { code: string; label: string }[] = [
  { code: '51', label: 'Information' },
  { code: '52', label: 'Finance and Insurance' },
  { code: '53', label: 'Real Estate and Rental and Leasing' },
  { code: '54', label: 'Professional, Scientific, and Technical Services' },
  { code: '55', label: 'Management of Companies and Enterprises' },
  { code: '56', label: 'Administrative and Support and Waste Management and Remediation Services' },
  { code: '62', label: 'Health Care and Social Assistance' },
]

// One line series per sector (raw values, not a percent share), all on one
// chart -- employment_by_sector/avg_pay_by_sector's shape, distinct from
// ACS's ChartResult union since ACS has no equivalent "many series on one
// chart, keyed by an arbitrary label" shape.
export interface SectorLineChart {
  chart_type: 'multi_line'
  series_by_label: Record<string, Record<string, number>>
}

export type BlsChartResult = LineChart | SectorLineChart
export type BlsDashboardResult = Record<string, BlsChartResult>

export type BlsRateBasis = '5yr' | '10yr' | 'custom_rate' | 'custom_years'

export interface BlsSectorParam {
  naics_code: string
  enabled: boolean
  rate_basis: BlsRateBasis
  custom_rate?: number
  custom_start_year?: number
  custom_end_year?: number
}

export interface BlsOfficeDemandParams {
  base_year: number
  target_year: number
  sectors: BlsSectorParam[]
}

export interface BlsSectorProjection {
  base_employment: number | null
  rate: number | null
  projected_employment: number | null
}

export interface BlsSectorSqftDemand {
  employment_delta: number
  sqft_demand?: number
  sqft_demand_low?: number
  sqft_demand_high?: number
}

export interface BlsPlaceAllocation {
  display_name: string
  allocated_sqft: number
}

export interface BlsOfficeDemandResult {
  county_geoid: string
  base_year: number
  target_year: number
  sector_projections: Record<string, BlsSectorProjection>
  sector_sqft_demand: Record<string, BlsSectorSqftDemand>
  countywide_professional_sqft_demand: number
  countywide_medical_sqft_demand_low: number
  countywide_medical_sqft_demand_high: number
  professional_sqft_by_place: Record<string, BlsPlaceAllocation>
  medical_sqft_by_place_low: Record<string, BlsPlaceAllocation>
  medical_sqft_by_place_high: Record<string, BlsPlaceAllocation>
}

export interface PumaStat {
  mean: number | null
  se: number | null
  n: number
}

export interface PumaSummary {
  household_size_by_unit_type: Record<string, PumaStat>
  school_children_by_unit_type: Record<string, PumaStat>
  household_size_by_bedroom_count: Record<string, PumaStat>
  school_children_by_bedroom_count: Record<string, PumaStat>
}

export interface AssumptionOption {
  key: string
  label: string
  value: number
  notes: string | null
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

// credentials: 'include' is required on every call now that data routes are
// gated behind a session cookie -- without it, the browser won't attach the
// cookie on cross-origin requests (frontend and backend are separate
// origins in production), and every request would 401.
async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `Request failed: ${res.status}`)
  }
  return res.json()
}

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
  }
  const res = await fetch(url.toString(), { credentials: 'include' })
  return handle<T>(res)
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle<T>(res)
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle<T>(res)
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', credentials: 'include' })
  return handle<T>(res)
}

// Multipart form POSTs -- the CoStar/SmartRE upload-clean-export modules are
// the first callers to send files instead of JSON, and the first to expect
// a raw file (Blob) back instead of parsed JSON. No Content-Type header is
// set on the request: the browser fills in the multipart boundary itself.
async function postForm(path: string, formData: FormData): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', body: formData })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `Request failed: ${res.status}`)
  }
  return res
}

async function postFormBlob(path: string, formData: FormData): Promise<Blob> {
  return (await postForm(path, formData)).blob()
}

// GET counterpart to postFormBlob -- the ACS/BLS "Download Data" retrofit's
// workbook routes are plain query-param GETs (mirroring their JSON
// counterparts exactly, see api.py), not file uploads, so this doesn't go
// through postForm's FormData path.
async function getBlob(path: string, params?: Record<string, string | number | undefined>): Promise<Blob> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
  }
  const res = await fetch(url.toString(), { credentials: 'include' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `Request failed: ${res.status}`)
  }
  return res.blob()
}

async function postFormJson<T>(path: string, formData: FormData): Promise<T> {
  return (await postForm(path, formData)).json()
}

// CoStar/SmartRE modules -- upload/clean/export, no persisted data, no
// dashboard shapes. CostarPropertyClass identifies which upload slot (and
// which sheet on the output workbook) a Market Overview file belongs to.
export type CostarPropertyClass = 'multifamily' | 'retail' | 'office' | 'industrial_flex' | 'hospitality'

export interface SmartReSubdivision {
  name: string
  count: number
}

export interface SmartReSubdivisionsResult {
  subdivisions: SmartReSubdivision[]
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

  // Chart-bearing workbook downloads -- server-side openpyxl export
  // (dashboard_excel_export.py), replacing the old client-side data-only
  // SheetJS export. Same query params as the JSON routes above (plus an
  // optional charts= selection, mirroring /dashboard/{geoid}'s existing
  // filter, and view_mode so category charts export the same percent/count
  // shares currently shown on screen), so the export always matches what's
  // on screen.
  downloadDashboardWorkbook: (
    geoid: string,
    params: { start_year: number; end_year: number; charts?: string; view_mode?: ChartViewMode }
  ) => getBlob(`/dashboard/${geoid}/workbook`, params),

  downloadDashboardRegionWorkbook: (
    geoids: string[],
    params: { start_year: number; end_year: number; charts?: string; view_mode?: ChartViewMode }
  ) => getBlob('/dashboard/region/workbook', { ...params, geoids: geoids.join(',') }),

  downloadDashboardWorkbookMulti: (
    geoids: string[],
    params: { start_year: number; end_year: number; charts?: string; view_mode?: ChartViewMode }
  ) => getBlob('/dashboard/workbook', { ...params, geoids: geoids.join(',') }),

  getHousingDemand: (geoid: string, params: HousingDemandParams) =>
    get<HousingDemandResult>(`/housing-demand/${geoid}`, { ...params }),

  getHousingDemandRegion: (geoids: string[], params: HousingDemandParams) =>
    get<HousingDemandResult>('/housing-demand/region', { ...params, geoids: geoids.join(',') }),

  getTurnoverTiers: () => get<TurnoverTierOption[]>('/housing-demand/assumptions/turnover-tiers'),

  auth: {
    me: () => get<AuthUser>('/auth/me'),
    loginUrl: () => `${API_BASE}/auth/login`,
    logoutUrl: () => `${API_BASE}/auth/logout`,
  },

  admin: {
    listUsers: () => get<AppUser[]>('/admin/users'),
    addUser: (email: string, role: UserRole) => post<AppUser>('/admin/users', { email, role }),
    removeUser: (email: string) => del<{ deleted: string }>(`/admin/users/${encodeURIComponent(email)}`),

    listAssumptions: (keyPrefix?: string) =>
      get<AssumptionOption[]>('/admin/assumptions', keyPrefix ? { key_prefix: keyPrefix } : undefined),
    upsertAssumption: (key: string, label: string, value: number, notes?: string) =>
      put<AssumptionOption>(`/admin/assumptions/${encodeURIComponent(key)}`, { label, value, notes }),
    removeAssumption: (key: string) => del<{ deleted: string }>(`/admin/assumptions/${encodeURIComponent(key)}`),
  },

  bls: {
    getDashboard: (geoid: string, params: { start_year: number; end_year: number; sectors?: string }) =>
      get<BlsDashboardResult>(`/bls/dashboard/${geoid}`, params),

    getDashboardRegion: (geoids: string[], params: { start_year: number; end_year: number; sectors?: string }) =>
      get<BlsDashboardResult>('/bls/dashboard/region', { ...params, geoids: geoids.join(',') }),

    downloadDashboardWorkbook: (geoid: string, params: { start_year: number; end_year: number; sectors?: string; charts?: string }) =>
      getBlob(`/bls/dashboard/${geoid}/workbook`, params),

    downloadDashboardRegionWorkbook: (
      geoids: string[],
      params: { start_year: number; end_year: number; sectors?: string; charts?: string }
    ) => getBlob('/bls/dashboard/region/workbook', { ...params, geoids: geoids.join(',') }),

    downloadDashboardWorkbookMulti: (
      geoids: string[],
      params: { start_year: number; end_year: number; sectors?: string; charts?: string }
    ) => getBlob('/bls/dashboard/workbook', { ...params, geoids: geoids.join(',') }),

    listCharts: () => get<string[]>('/bls/dashboard/charts/list'),

    getOfficeDemandAssumptions: () => get<AssumptionOption[]>('/bls/office-demand/assumptions'),

    projectOfficeDemand: (geoid: string, body: BlsOfficeDemandParams) =>
      post<BlsOfficeDemandResult>(`/bls/office-demand/${geoid}`, body),
  },

  pums: {
    getHouseholdSummary: (geoid: string) => get<PumaSummary>(`/pums/household-summary/${geoid}`),
  },

  costar: {
    heartbeat: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return postFormBlob('/costar/heartbeat', fd)
    },

    // One upload slot per property class per market; only classes actually
    // uploaded are sent -- the backend only builds a tab for a class if at
    // least one market supplied it, per the confirmed "not required to
    // upload all of them" requirement.
    marketOverview: (markets: { name: string; files: Partial<Record<CostarPropertyClass, File>> }[]) => {
      const fd = new FormData()
      fd.append('market_count', String(markets.length))
      markets.forEach((m, i) => {
        fd.append(`market_${i}_name`, m.name)
        for (const [cls, file] of Object.entries(m.files)) {
          if (file) fd.append(`market_${i}_${cls}`, file)
        }
      })
      return postFormBlob('/costar/market-overview', fd)
    },

    multifamilyComps: (comps: { name: string; file: File }[]) => {
      const fd = new FormData()
      comps.forEach((c) => {
        fd.append('names', c.name)
        fd.append('files', c.file)
      })
      return postFormBlob('/costar/multifamily-comps', fd)
    },
  },

  smartre: {
    // Step 1 of the "Live Environment" flow: upload up to 20 files, get
    // back the distinct subdivisions present so the user can pick a comp
    // set before generation.
    listSubdivisions: (files: File[]) => {
      const fd = new FormData()
      files.forEach((f) => fd.append('files', f))
      return postFormJson<SmartReSubdivisionsResult>('/smartre/subdivisions', fd)
    },

    // Step 2: the same files (re-sent -- nothing is cached server-side,
    // these modules are stateless) plus the chosen subdivisions.
    salesAnalysis: (files: File[], subdivisions: string[]) => {
      const fd = new FormData()
      files.forEach((f) => fd.append('files', f))
      subdivisions.forEach((s) => fd.append('subdivisions', s))
      return postFormBlob('/smartre/sales-analysis', fd)
    },
  },

  master: {
    // Regional mode is aggregated-only (no Separated option, confirmed
    // with the user -- see api.py's post_master_deck docstring). The
    // comparison fields are entirely optional/independent from acsCharts/
    // blsCharts -- a separate opt-in section with its own chart-topic
    // selection, up to 5 comparison geographies (always flat single
    // geographies, not themselves regional, mirroring the normal
    // Comparative Analysis flow's own max-5 cap). CoStar/SmartRE uploads
    // land in later stages -- those fields get added to this same
    // FormData then, matching costar.marketOverview's indexed-field
    // convention from the start so the request shape doesn't change
    // underneath the wizard later.
    generateDeck: (params: {
      placeType: GeoType
      mode: 'single' | 'regional'
      geoids: string[]
      startYear: number
      endYear: number
      acsCharts: string[]
      blsCharts: string[]
      comparisonGeoids?: string[]
      comparisonAcsCharts?: string[]
      comparisonBlsCharts?: string[]
      heartbeatFile?: File | null
      marketOverviewMarkets?: { name: string; files: Partial<Record<CostarPropertyClass, File>> }[]
      smartreFiles?: File[]
      smartreSubdivisions?: string[]
      comparisonCostar?: {
        geoid: string
        heartbeatFile?: File | null
        marketOverviewMarkets?: { name: string; files: Partial<Record<CostarPropertyClass, File>> }[]
      }[]
      reportTitle?: string
    }) => {
      const fd = new FormData()
      fd.append('place_type', params.placeType)
      fd.append('mode', params.mode)
      fd.append('geoids', params.geoids.join(','))
      fd.append('start_year', String(params.startYear))
      fd.append('end_year', String(params.endYear))
      fd.append('acs_charts', params.acsCharts.join(','))
      fd.append('bls_charts', params.blsCharts.join(','))
      if (params.comparisonGeoids?.length) {
        fd.append('comparison_geoids', params.comparisonGeoids.join(','))
        fd.append('comparison_acs_charts', (params.comparisonAcsCharts ?? []).join(','))
        fd.append('comparison_bls_charts', (params.comparisonBlsCharts ?? []).join(','))
      }
      if (params.heartbeatFile) {
        fd.append('subject_costar_properties', params.heartbeatFile)
      }
      if (params.marketOverviewMarkets?.length) {
        fd.append('subject_market_count', String(params.marketOverviewMarkets.length))
        params.marketOverviewMarkets.forEach((m, i) => {
          fd.append(`subject_market_${i}_name`, m.name)
          for (const [cls, file] of Object.entries(m.files)) {
            if (file) fd.append(`subject_market_${i}_${cls}`, file)
          }
        })
      }
      if (params.smartreFiles?.length && params.smartreSubdivisions?.length) {
        params.smartreFiles.forEach((f) => fd.append('subject_smartre_files', f))
        params.smartreSubdivisions.forEach((s) => fd.append('subject_smartre_subdivisions', s))
      }
      // Per-comparison-geo CoStar repeater -- same Heartbeat/Market
      // Overview field shape as the subject's own upload above, just
      // "comparison_{geoid}_"-prefixed per geography.
      params.comparisonCostar?.forEach((c) => {
        if (c.heartbeatFile) {
          fd.append(`comparison_${c.geoid}_costar_properties`, c.heartbeatFile)
        }
        const markets = c.marketOverviewMarkets ?? []
        if (markets.length) {
          fd.append(`comparison_${c.geoid}_market_count`, String(markets.length))
          markets.forEach((m, i) => {
            fd.append(`comparison_${c.geoid}_market_${i}_name`, m.name)
            for (const [cls, file] of Object.entries(m.files)) {
              if (file) fd.append(`comparison_${c.geoid}_market_${i}_${cls}`, file)
            }
          })
        }
      })
      if (params.reportTitle) {
        fd.append('report_title', params.reportTitle)
      }
      return postFormBlob('/master/deck', fd)
    },
  },
}
