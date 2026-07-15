import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type GeoType, type DashboardResult } from '../lib/api'
import { CHART_META, type ChartViewMode } from '../lib/chartMeta'
import GeographyList from '../components/GeographyList'
import GeographyMap from '../components/GeographyMap'
import LineChartCard from '../components/charts/LineChartCard'
import StackedBarChartCard from '../components/charts/StackedBarChartCard'
import BinBarChartCard from '../components/charts/BinBarChartCard'
import MultiGeoDashboard from './MultiGeoDashboard'
import { dashboardSheets } from '../lib/download'
import DownloadSheetsButton from '../components/DownloadSheetsButton'

const MAX_REGION_SIZE = 50
const MIN_YEAR = 2010
const MAX_YEAR = 2024

export default function RegionalAnalysis() {
  const [geoType, setGeoType] = useState<GeoType>('place')
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [selectedGeoids, setSelectedGeoids] = useState<string[]>([])
  const [geoLabels, setGeoLabels] = useState<Record<string, string>>({})
  const [showDashboard, setShowDashboard] = useState<'aggregated' | 'separated' | null>(null)

  function toggleGeo(geoid: string) {
    setSelectedGeoids((prev) => (prev.includes(geoid) ? prev.filter((g) => g !== geoid) : prev.length < MAX_REGION_SIZE ? [...prev, geoid] : prev))
  }

  // Track display names for whatever's currently selected, for the
  // Separated view's per-geography labels and the summary line.
  useEffect(() => {
    const missing = selectedGeoids.filter((g) => !(g in geoLabels))
    if (missing.length === 0) return
    Promise.all(missing.map((g) => api.getGeography(g).then((geo) => [g, geo.display_name] as const).catch(() => [g, g] as const))).then(
      (pairs) => setGeoLabels((prev) => ({ ...prev, ...Object.fromEntries(pairs) }))
    )
  }, [selectedGeoids, geoLabels])

  if (showDashboard === 'separated') {
    const geographies = selectedGeoids.map((geoid) => ({ geoid, label: geoLabels[geoid] ?? geoid }))
    return (
      <div className="flex-1 flex flex-col items-center px-6 py-10 gap-4">
        <div className="text-center">
          <h1 className="text-3xl font-medium text-abakus-charcoal mb-1">Regional Analysis -- Separated</h1>
          <button type="button" onClick={() => setShowDashboard(null)} className="text-abakus-blue hover:underline text-sm">
            Change geographies
          </button>
        </div>
        <MultiGeoDashboard geographies={geographies} />
      </div>
    )
  }

  if (showDashboard === 'aggregated') {
    return <AggregatedDashboard geoids={selectedGeoids} onBack={() => setShowDashboard(null)} />
  }

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-12 gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-2">Regional Analysis</h1>
        <p className="text-abakus-light-grey">Select as many geographies as you need for your region.</p>
      </div>

      <div className="flex gap-6 items-center">
        <ToggleGroup
          value={geoType}
          onChange={(v) => {
            setGeoType(v as GeoType)
            setSelectedGeoids([])
          }}
          options={[
            { value: 'place', label: 'Place' },
            { value: 'county', label: 'County' },
          ]}
        />
        <ToggleGroup value={viewMode} onChange={(v) => setViewMode(v as 'list' | 'map')} options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />
      </div>

      <div className="w-full max-w-lg flex justify-center">
        {viewMode === 'list' ? (
          <GeographyList key={geoType} geoType={geoType} selectedGeoids={selectedGeoids} onToggle={toggleGeo} maxSelect={MAX_REGION_SIZE} />
        ) : (
          <div className="w-full">
            <GeographyMap geoType={geoType} selectedGeoids={selectedGeoids} onToggle={toggleGeo} />
          </div>
        )}
      </div>

      {selectedGeoids.length > 0 && (
        <div className="flex flex-col items-center gap-3 border-t border-abakus-charcoal/10 pt-6 w-full max-w-lg">
          <p className="text-abakus-charcoal text-sm text-center">
            {selectedGeoids.length} geograph{selectedGeoids.length === 1 ? 'y' : 'ies'} selected:{' '}
            {selectedGeoids.map((g) => geoLabels[g] ?? '...').join(', ')}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowDashboard('aggregated')}
              className="bg-abakus-orange text-white font-medium px-5 py-2 rounded-lg hover:opacity-90 transition-opacity"
            >
              View Aggregated
            </button>
            <button
              type="button"
              onClick={() => setShowDashboard('separated')}
              className="bg-white border border-abakus-orange text-abakus-orange font-medium px-5 py-2 rounded-lg hover:bg-abakus-orange/5 transition-colors"
            >
              View Separated
            </button>
          </div>
        </div>
      )}

      <Link to="/" className="text-abakus-blue hover:underline text-sm mt-auto">
        Back to mode selection
      </Link>
    </div>
  )
}

function AggregatedDashboard({ geoids, onBack }: { geoids: string[]; onBack: () => void }) {
  const [startYear, setStartYear] = useState(MIN_YEAR)
  const [endYear, setEndYear] = useState(MAX_YEAR)
  const [viewMode, setViewMode] = useState<ChartViewMode>('percent')
  const [charts, setCharts] = useState<DashboardResult | null>(null)
  const [excluded, setExcluded] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getDashboardRegion(geoids, { start_year: startYear, end_year: endYear })
      .then((res) => {
        setCharts(res.charts)
        setExcluded(res.excluded_charts)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [geoids, startYear, endYear])

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-10 gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-1">Regional Analysis -- Aggregated</h1>
        <p className="text-abakus-light-grey text-sm">{geoids.length} geographies summed as one region</p>
        <button type="button" onClick={onBack} className="text-abakus-blue hover:underline text-sm mt-1">
          Change geographies
        </button>
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

      {excluded.length > 0 && (
        <p className="text-xs text-abakus-light-grey max-w-md text-center">
          True medians (median home value, rent, age, household income) can't be validly derived from a region's constituent
          medians, so they're omitted here. See the Separated view for per-geography medians.
        </p>
      )}

      {error && <p className="text-abakus-warm-400">{error}</p>}
      {loading && <p className="text-abakus-light-grey">Loading...</p>}

      {charts && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 w-full max-w-[1600px]">
          {Object.entries(charts).map(([key, chart]) => {
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

      {charts && (
        <DownloadSheetsButton
          filename="Regional Analysis.xlsx"
          sheets={dashboardSheets(charts, (key) => CHART_META[key]?.title ?? key, viewMode)}
        />
      )}
    </div>
  )
}

function YearSelect({ value, onChange, min = MIN_YEAR, max = MAX_YEAR }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const years = []
  for (let y = MIN_YEAR; y <= MAX_YEAR; y++) years.push(y)
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="border border-abakus-charcoal/20 rounded-lg px-2 py-1 bg-white">
      {years.map((y) => (
        <option key={y} value={y} disabled={y < min || y > max}>
          {y}
        </option>
      ))}
    </select>
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
          className={`px-4 py-1.5 text-sm font-medium transition-colors ${
            value === opt.value ? 'bg-abakus-charcoal text-white' : 'bg-white text-abakus-charcoal hover:bg-abakus-cream'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
