import { useEffect, useState } from 'react'
import { api, type BarChart, type DashboardResult, type LineChart, type StackedBarChart } from '../lib/api'
import { CHART_META, type ChartViewMode } from '../lib/chartMeta'
import MultiGeoLineChartCard from '../components/charts/MultiGeoLineChartCard'
import MultiGeoStackedBarChartCard from '../components/charts/MultiGeoStackedBarChartCard'
import MultiGeoBinBarChartCard from '../components/charts/MultiGeoBinBarChartCard'

const MIN_YEAR = 2010
const MAX_YEAR = 2024

interface Props {
  geographies: { geoid: string; label: string }[]
}

// Shared by Comparative Analysis and Regional Analysis's "Separated" view --
// both are "N geographies side by side," just arrived at differently
// (comparative-communities suggestions vs. a free multi-select).
export default function MultiGeoDashboard({ geographies }: Props) {
  const [startYear, setStartYear] = useState(MIN_YEAR)
  const [endYear, setEndYear] = useState(MAX_YEAR)
  const [viewMode, setViewMode] = useState<ChartViewMode>('percent')
  const [dataByGeoid, setDataByGeoid] = useState<Record<string, DashboardResult>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (geographies.length === 0) return
    setLoading(true)
    setError(null)
    Promise.all(geographies.map((g) => api.getDashboard(g.geoid, { start_year: startYear, end_year: endYear })))
      .then((results) => {
        const map: Record<string, DashboardResult> = {}
        geographies.forEach((g, i) => (map[g.geoid] = results[i]))
        setDataByGeoid(map)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [geographies, startYear, endYear])

  if (geographies.length === 0) return null

  const chartNames = Object.keys(CHART_META)

  return (
    <div className="flex flex-col items-center gap-6 w-full">
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

      <p className="text-xs text-abakus-light-grey text-center max-w-md">
        Category breakdowns show {startYear} and {endYear} only. Trend charts show every year in range.
      </p>

      {error && <p className="text-abakus-warm-400">{error}</p>}
      {loading && <p className="text-abakus-light-grey">Loading...</p>}

      {!loading && Object.keys(dataByGeoid).length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 w-full max-w-6xl">
          {chartNames.map((key) => {
            const meta = CHART_META[key]
            const firstResult = dataByGeoid[geographies[0].geoid]?.[key]
            if (!firstResult) return null

            if (firstResult.chart_type === 'line') {
              const charts: Record<string, LineChart> = {}
              geographies.forEach((g) => {
                const c = dataByGeoid[g.geoid]?.[key]
                if (c?.chart_type === 'line') charts[g.geoid] = c
              })
              return <MultiGeoLineChartCard key={key} title={meta.title} format={meta.format} geographies={geographies} charts={charts} />
            }

            if (firstResult.chart_type === 'bar') {
              const charts: Record<string, BarChart> = {}
              geographies.forEach((g) => {
                const c = dataByGeoid[g.geoid]?.[key]
                if (c?.chart_type === 'bar') charts[g.geoid] = c
              })
              return <MultiGeoBinBarChartCard key={key} title={meta.title} geographies={geographies} charts={charts} viewMode={viewMode} />
            }

            const charts: Record<string, StackedBarChart> = {}
            geographies.forEach((g) => {
              const c = dataByGeoid[g.geoid]?.[key]
              if (c?.chart_type === 'stacked_bar') charts[g.geoid] = c
            })
            return (
              <MultiGeoStackedBarChartCard
                key={key}
                title={meta.title}
                geographies={geographies}
                charts={charts}
                startYear={startYear}
                endYear={endYear}
                viewMode={viewMode}
              />
            )
          })}
        </div>
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
