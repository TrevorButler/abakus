import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type DashboardResult, type GeographySummary, type GeoType } from '../lib/api'
import { CHART_META } from '../lib/chartMeta'
import LineChartCard from '../components/charts/LineChartCard'
import StackedBarChartCard from '../components/charts/StackedBarChartCard'
import BinBarChartCard from '../components/charts/BinBarChartCard'

const MIN_YEAR = 2010
const MAX_YEAR = 2024

export default function Dashboard() {
  const { geoid } = useParams<{ geoid: string }>()
  const [geo, setGeo] = useState<(GeographySummary & { geo_type: GeoType }) | null>(null)
  const [startYear, setStartYear] = useState(MIN_YEAR)
  const [endYear, setEndYear] = useState(MAX_YEAR)
  const [dashboard, setDashboard] = useState<DashboardResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!geoid) return
    api.getGeography(geoid).then(setGeo).catch(() => setGeo(null))
  }, [geoid])

  useEffect(() => {
    if (!geoid) return
    setLoading(true)
    setError(null)
    api
      .getDashboard(geoid, { start_year: startYear, end_year: endYear })
      .then(setDashboard)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [geoid, startYear, endYear])

  if (!geoid) return null

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-10 gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-1">{geo?.display_name ?? 'Loading...'}</h1>
        <Link to="/single" className="text-abakus-blue hover:underline text-sm">
          Choose a different geography
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
      </div>

      {error && <p className="text-abakus-warm-400">{error}</p>}
      {loading && <p className="text-abakus-light-grey">Loading dashboard...</p>}

      {dashboard && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 w-full max-w-6xl">
          {Object.entries(dashboard).map(([key, chart]) => {
            const meta = CHART_META[key] ?? { title: key, format: 'count' as const }
            if (chart.chart_type === 'line') {
              return <LineChartCard key={key} title={meta.title} format={meta.format} series={chart.series} />
            }
            if (chart.chart_type === 'bar') {
              return <BinBarChartCard key={key} title={meta.title} format={meta.format} categories={chart.categories} />
            }
            return <StackedBarChartCard key={key} title={meta.title} categories={chart.categories} />
          })}
        </div>
      )}
    </div>
  )
}

function YearSelect({
  value,
  onChange,
  min = MIN_YEAR,
  max = MAX_YEAR,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
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
