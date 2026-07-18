import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, NAICS_SECTORS, type BlsDashboardResult, type LineChart } from '../lib/api'
import { blsChartMeta, blsDashboardSheets } from '../lib/blsChartMeta'
import GeographyList from '../components/GeographyList'
import GeographyMap from '../components/GeographyMap'
import SectorToggles from '../components/SectorToggles'
import LineChartCard from '../components/charts/LineChartCard'
import MultiGeoLineChartCard from '../components/charts/MultiGeoLineChartCard'
import BlsMultiGeoDashboard from './BlsMultiGeoDashboard'
import DownloadSheetsButton from '../components/DownloadSheetsButton'

const MAX_REGION_SIZE = 50
const MIN_YEAR = 2014 // QCEW's bulk open-data API only serves a rolling window, not back to 2010
const MAX_YEAR = 2025

// Mirrors RegionalAnalysis.tsx's aggregated/separated shape, per the
// confirmed requirement that BLS's comparative view look like Regional
// Analysis rather than Comparative Analysis's similarity-ranked
// suggestions. County-only (no place/county toggle) since QCEW is
// published at county granularity, and no "top N industries" ranking in
// either mode (explicitly excluded).
export default function BlsComparative() {
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [selectedGeoids, setSelectedGeoids] = useState<string[]>([])
  const [geoLabels, setGeoLabels] = useState<Record<string, string>>({})
  const [sectors, setSectors] = useState<string[]>(NAICS_SECTORS.map((s) => s.code))
  const [showDashboard, setShowDashboard] = useState<'aggregated' | 'separated' | null>(null)

  function toggleGeo(geoid: string) {
    setSelectedGeoids((prev) => (prev.includes(geoid) ? prev.filter((g) => g !== geoid) : prev.length < MAX_REGION_SIZE ? [...prev, geoid] : prev))
  }

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
          <h1 className="text-3xl font-medium text-abakus-charcoal mb-1">BLS Comparative -- Separated</h1>
          <button type="button" onClick={() => setShowDashboard(null)} className="text-abakus-blue hover:underline text-sm">
            Change counties
          </button>
        </div>
        <SectorToggles selected={sectors} onChange={setSectors} />
        <BlsMultiGeoDashboard geographies={geographies} sectors={sectors} />
      </div>
    )
  }

  if (showDashboard === 'aggregated') {
    return <AggregatedDashboard geoids={selectedGeoids} sectors={sectors} onSectorsChange={setSectors} onBack={() => setShowDashboard(null)} />
  }

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-12 gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-2">BLS Comparative</h1>
        <p className="text-abakus-light-grey">Select as many counties as you need for your comparison.</p>
      </div>

      <ToggleGroup value={viewMode} onChange={(v) => setViewMode(v as 'list' | 'map')} options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />

      <div className="w-full max-w-lg flex justify-center">
        {viewMode === 'list' ? (
          <GeographyList geoType="county" selectedGeoids={selectedGeoids} onToggle={toggleGeo} maxSelect={MAX_REGION_SIZE} />
        ) : (
          <div className="w-full">
            <GeographyMap geoType="county" selectedGeoids={selectedGeoids} onToggle={toggleGeo} />
          </div>
        )}
      </div>

      {selectedGeoids.length > 0 && (
        <div className="flex flex-col items-center gap-3 border-t border-abakus-charcoal/10 pt-6 w-full max-w-lg">
          <p className="text-abakus-charcoal text-sm text-center">
            {selectedGeoids.length} count{selectedGeoids.length === 1 ? 'y' : 'ies'} selected:{' '}
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

      <Link to="/bls" className="text-abakus-blue hover:underline text-sm mt-auto">
        Back to mode selection
      </Link>
    </div>
  )
}

function AggregatedDashboard({
  geoids,
  sectors,
  onSectorsChange,
  onBack,
}: {
  geoids: string[]
  sectors: string[]
  onSectorsChange: (codes: string[]) => void
  onBack: () => void
}) {
  const [startYear, setStartYear] = useState(MIN_YEAR)
  const [endYear, setEndYear] = useState(MAX_YEAR)
  const [charts, setCharts] = useState<BlsDashboardResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sectors.length === 0) return
    setLoading(true)
    setError(null)
    api.bls
      .getDashboardRegion(geoids, { start_year: startYear, end_year: endYear, sectors: sectors.join(',') })
      .then(setCharts)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [geoids, sectors, startYear, endYear])

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-10 gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-1">BLS Comparative -- Aggregated</h1>
        <p className="text-abakus-light-grey text-sm">{geoids.length} counties summed as one region</p>
        <button type="button" onClick={onBack} className="text-abakus-blue hover:underline text-sm mt-1">
          Change counties
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
      </div>

      <SectorToggles selected={sectors} onChange={onSectorsChange} />

      {sectors.length === 0 && <p className="text-abakus-warm-400 text-sm">Select at least one sector.</p>}
      {error && <p className="text-abakus-warm-400">{error}</p>}
      {loading && <p className="text-abakus-light-grey">Loading...</p>}

      {charts && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 w-full max-w-[1600px]">
          {Object.entries(charts).map(([key, chart]) => {
            const meta = blsChartMeta(key)
            if (chart.chart_type === 'line') {
              return <LineChartCard key={key} title={meta.title} format={meta.format} series={chart.series} />
            }
            const labels = Object.keys(chart.series_by_label)
            const geographies = labels.map((label) => ({ geoid: label, label }))
            const geoCharts: Record<string, LineChart> = Object.fromEntries(
              labels.map((label) => [label, { chart_type: 'line' as const, series: chart.series_by_label[label] }])
            )
            return <MultiGeoLineChartCard key={key} title={meta.title} format={meta.format} geographies={geographies} charts={geoCharts} />
          })}
        </div>
      )}

      {charts && (
        <DownloadSheetsButton
          filename="BLS Comparative Aggregated.xlsx"
          sheets={blsDashboardSheets(charts, (key) => blsChartMeta(key).title)}
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
