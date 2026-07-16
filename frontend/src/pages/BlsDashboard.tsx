import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, BLS_SECTORS, type BlsDashboardResult, type GeographySummary, type GeoType } from '../lib/api'
import { blsChartMeta } from '../lib/blsChartMeta'
import LineChartCard from '../components/charts/LineChartCard'
import StackedBarChartCard from '../components/charts/StackedBarChartCard'
import SectorToggles from '../components/SectorToggles'
import { dashboardSheets } from '../lib/download'
import DownloadSheetsButton from '../components/DownloadSheetsButton'

const MIN_YEAR = 2014 // QCEW's bulk open-data API only serves a rolling window, not back to 2010
const MAX_YEAR = 2025

export default function BlsDashboard() {
  const { geoid } = useParams<{ geoid: string }>()
  const [geo, setGeo] = useState<(GeographySummary & { geo_type: GeoType }) | null>(null)
  const [startYear, setStartYear] = useState(MIN_YEAR)
  const [endYear, setEndYear] = useState(MAX_YEAR)
  const [viewMode, setViewMode] = useState<'percent' | 'count'>('percent')
  const [sectors, setSectors] = useState<string[]>(BLS_SECTORS.map((s) => s.code))
  const [dashboard, setDashboard] = useState<BlsDashboardResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!geoid) return
    api.getGeography(geoid).then(setGeo).catch(() => setGeo(null))
  }, [geoid])

  useEffect(() => {
    if (!geoid || sectors.length === 0) return
    setLoading(true)
    setError(null)
    api.bls
      .getDashboard(geoid, { start_year: startYear, end_year: endYear, sectors: sectors.join(',') })
      .then(setDashboard)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [geoid, startYear, endYear, sectors])

  if (!geoid) return null

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-10 gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-1">{geo?.display_name ?? 'Loading...'}</h1>
        <Link to="/bls/single" className="text-abakus-blue hover:underline text-sm">
          Choose a different county
        </Link>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          From
          <YearSelect value={startYear} onChange={setStartYear} max={endYear} />
        </label>
        <label className="flex items-center gap-2">
          To
          <YearSelect value={endYear} onChange={setEndYear} min={startYear} />
        </label>
        <ToggleGroup
          value={viewMode}
          onChange={(v) => setViewMode(v as 'percent' | 'count')}
          options={[
            { value: 'percent', label: '%' },
            { value: 'count', label: '#' },
          ]}
        />
      </div>

      <SectorToggles selected={sectors} onChange={setSectors} />

      {sectors.length === 0 && <p className="text-abakus-warm-400 text-sm">Select at least one sector.</p>}
      {error && <p className="text-abakus-warm-400">{error}</p>}
      {loading && <p className="text-abakus-light-grey">Loading dashboard...</p>}

      {dashboard && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 w-full max-w-[1600px]">
          {Object.entries(dashboard).map(([key, chart]) => {
            const meta = blsChartMeta(key)
            if (chart.chart_type === 'line') {
              return <LineChartCard key={key} title={meta.title} format={meta.format} series={chart.series} />
            }
            return (
              <StackedBarChartCard
                key={key}
                title={meta.title}
                categories={chart.categories}
                rawCategories={chart.raw_categories}
                viewMode={viewMode}
              />
            )
          })}
        </div>
      )}

      {dashboard && (
        <DownloadSheetsButton
          filename={`${geo?.display_name ?? geoid} - BLS.xlsx`}
          sheets={dashboardSheets(dashboard, (key) => blsChartMeta(key).title, viewMode)}
        />
      )}
    </div>
  )
}

function ToggleGroup({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-abakus-charcoal/15 overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
            value === opt.value ? 'bg-abakus-charcoal text-white' : 'bg-white text-abakus-charcoal hover:bg-abakus-cream'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function YearSelect({ value, onChange, min = MIN_YEAR, max = MAX_YEAR }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const years = []
  for (let y = MIN_YEAR; y <= MAX_YEAR; y++) years.push(y)
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="border border-abakus-charcoal/20 rounded-lg px-2 py-1 bg-white"
    >
      {years.map((y) => (
        <option key={y} value={y} disabled={y < min || y > max}>
          {y}
        </option>
      ))}
    </select>
  )
}
