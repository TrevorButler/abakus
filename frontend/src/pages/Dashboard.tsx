import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type DashboardResult, type GeographySummary, type GeoType } from '../lib/api'
import { CHART_META, type ChartViewMode } from '../lib/chartMeta'
import LineChartCard from '../components/charts/LineChartCard'
import StackedBarChartCard from '../components/charts/StackedBarChartCard'
import BinBarChartCard from '../components/charts/BinBarChartCard'
import DownloadWorkbookButton from '../components/DownloadWorkbookButton'

const MIN_YEAR = 2010
const MAX_YEAR = 2024

export default function Dashboard() {
  const { geoid } = useParams<{ geoid: string }>()
  const [geo, setGeo] = useState<(GeographySummary & { geo_type: GeoType }) | null>(null)
  const [startYear, setStartYear] = useState(MIN_YEAR)
  const [endYear, setEndYear] = useState(MAX_YEAR)
  const [viewMode, setViewMode] = useState<ChartViewMode>('percent')
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
        <Link to="/acs/single" className="text-abakus-blue hover:underline text-sm">
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
        <ToggleGroup
          value={viewMode}
          onChange={(v) => setViewMode(v as ChartViewMode)}
          options={[
            { value: 'percent', label: '%' },
            { value: 'count', label: '#' },
          ]}
        />
      </div>

      {error && <p className="text-abakus-warm-400">{error}</p>}
      {loading && <p className="text-abakus-light-grey">Loading dashboard...</p>}

      {dashboard && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 w-full max-w-[1600px]">
          {Object.entries(dashboard).map(([key, chart]) => {
            const meta = CHART_META[key] ?? { title: key, format: 'count' as const }
            if (chart.chart_type === 'line') {
              return <LineChartCard key={key} title={meta.title} format={meta.format} series={chart.series} />
            }
            if (chart.chart_type === 'bar') {
              return (
                <BinBarChartCard
                  key={key}
                  title={meta.title}
                  format={meta.format}
                  categories={chart.categories}
                  rawCategories={chart.raw_categories}
                  viewMode={viewMode}
                />
              )
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
        <DownloadWorkbookButton
          filename={`${geo?.display_name ?? geoid}.xlsx`}
          chartKeys={Object.keys(dashboard)}
          titleFor={(key) => CHART_META[key]?.title ?? key}
          fetchWorkbook={(selectedKeys) =>
            api.downloadDashboardWorkbook(geoid, {
              start_year: startYear,
              end_year: endYear,
              charts: selectedKeys.join(','),
              view_mode: viewMode,
            })
          }
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
