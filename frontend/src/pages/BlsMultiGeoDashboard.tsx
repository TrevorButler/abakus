import { useEffect, useState } from 'react'
import { api, type BlsDashboardResult, type LineChart } from '../lib/api'
import { blsChartMeta, blsMultiGeoDashboardSheets } from '../lib/blsChartMeta'
import MultiGeoLineChartCard from '../components/charts/MultiGeoLineChartCard'
import MultiGeoSectorLineChartCard from '../components/charts/MultiGeoSectorLineChartCard'
import DownloadSheetsButton from '../components/DownloadSheetsButton'

const MIN_YEAR = 2014 // QCEW's bulk open-data API only serves a rolling window, not back to 2010
const MAX_YEAR = 2025

interface Props {
  geographies: { geoid: string; label: string }[]
  sectors: string[]
}

// BLS's "Separated" comparative view -- mirrors MultiGeoDashboard.tsx's
// shape exactly, but chart names are derived from the actual response
// (one entry per selected sector) rather than a fixed CHART_META, since
// BLS sectors are user-toggleable rather than a static 27-chart set. Only
// line/multi_line chart types exist here (no "bar"/"stacked_bar", unlike ACS).
export default function BlsMultiGeoDashboard({ geographies, sectors }: Props) {
  const [startYear, setStartYear] = useState(MIN_YEAR)
  const [endYear, setEndYear] = useState(MAX_YEAR)
  const [dataByGeoid, setDataByGeoid] = useState<Record<string, BlsDashboardResult>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (geographies.length === 0 || sectors.length === 0) return
    setLoading(true)
    setError(null)
    Promise.all(
      geographies.map((g) => api.bls.getDashboard(g.geoid, { start_year: startYear, end_year: endYear, sectors: sectors.join(',') }))
    )
      .then((results) => {
        const map: Record<string, BlsDashboardResult> = {}
        geographies.forEach((g, i) => (map[g.geoid] = results[i]))
        setDataByGeoid(map)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [geographies, sectors, startYear, endYear])

  if (geographies.length === 0) return null

  const chartNames = Object.keys(dataByGeoid[geographies[0]?.geoid] ?? {})

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
      </div>

      <p className="text-xs text-abakus-light-grey text-center max-w-md">
        Employment/wages by sector show {startYear} and {endYear} only. Trend charts show every year in range.
      </p>

      {error && <p className="text-abakus-warm-400">{error}</p>}
      {loading && <p className="text-abakus-light-grey">Loading...</p>}

      {!loading && chartNames.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 w-full max-w-[1800px]">
          {chartNames.map((key) => {
            const meta = blsChartMeta(key)
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

            const seriesByLabelByGeoid: Record<string, Record<string, Record<string, number>> | undefined> = {}
            geographies.forEach((g) => {
              const c = dataByGeoid[g.geoid]?.[key]
              seriesByLabelByGeoid[g.geoid] = c?.chart_type === 'multi_line' ? c.series_by_label : undefined
            })
            return (
              <MultiGeoSectorLineChartCard
                key={key}
                title={meta.title}
                format={meta.format}
                geographies={geographies}
                seriesByLabelByGeoid={seriesByLabelByGeoid}
              />
            )
          })}
        </div>
      )}

      {!loading && chartNames.length > 0 && (
        <DownloadSheetsButton
          filename="BLS Comparison.xlsx"
          sheets={blsMultiGeoDashboardSheets(geographies, dataByGeoid, chartNames, (key) => blsChartMeta(key).title)}
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
