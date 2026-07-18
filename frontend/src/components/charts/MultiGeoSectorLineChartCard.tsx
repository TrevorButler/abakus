import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { CATEGORY_COLORS, formatValue, type ValueFormat } from '../../lib/chartMeta'
import { ChartCardShell } from './LineChartCard'
import { downloadCSV } from '../../lib/download'

interface Props {
  title: string
  format: ValueFormat
  geographies: { geoid: string; label: string }[]
  seriesByLabelByGeoid: Record<string, Record<string, Record<string, number>> | undefined>
}

// BLS's "Separated" comparative view for employment_by_sector/avg_pay_by_sector
// -- unlike every other multi-geo chart (which compares ONE metric across
// geographies), this data is already multi-series WITHIN each geography
// (one line per sector), so combining across geographies the normal way
// isn't meaningful. Instead: one small multi-line chart per geography,
// mirroring MultiGeoStackedBarChartCard's small-multiples grid.
export default function MultiGeoSectorLineChartCard({ title, format, geographies, seriesByLabelByGeoid }: Props) {
  const allLabels = Array.from(
    new Set(geographies.flatMap((g) => Object.keys(seriesByLabelByGeoid[g.geoid] ?? {})))
  )

  const rows: (string | number)[][] = [
    ['Geography', 'Year', ...allLabels],
    ...geographies.flatMap((g) => {
      const seriesByLabel = seriesByLabelByGeoid[g.geoid]
      if (!seriesByLabel) return []
      const years = Array.from(new Set(allLabels.flatMap((l) => Object.keys(seriesByLabel[l] ?? {})))).sort()
      return years.map((y) => [g.label, y, ...allLabels.map((l) => seriesByLabel[l]?.[y] ?? '')])
    }),
  ]

  return (
    <ChartCardShell title={title} onDownload={() => downloadCSV(`${title}.csv`, rows)}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {geographies.map((g) => {
          const seriesByLabel = seriesByLabelByGeoid[g.geoid]
          const years = seriesByLabel ? Array.from(new Set(allLabels.flatMap((l) => Object.keys(seriesByLabel[l] ?? {})))).sort() : []
          const data = years.map((y) => {
            const row: Record<string, number | string> = { year: y }
            allLabels.forEach((l) => {
              const v = seriesByLabel?.[l]?.[y]
              if (v !== undefined) row[l] = v
            })
            return row
          })
          return (
            <div key={g.geoid} className="flex flex-col items-center">
              <p className="text-xs text-abakus-light-grey mb-1 text-center truncate w-full" title={g.label}>
                {g.label}
              </p>
              {data.length === 0 ? (
                <p className="text-xs text-abakus-light-grey/60">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                    <YAxis hide />
                    <Tooltip formatter={(v) => formatValue(Number(v), format)} />
                    {allLabels.map((label, i) => (
                      <Line
                        key={label}
                        type="monotone"
                        dataKey={label}
                        stroke={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                        strokeWidth={1.5}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          )
        })}
      </div>
    </ChartCardShell>
  )
}
