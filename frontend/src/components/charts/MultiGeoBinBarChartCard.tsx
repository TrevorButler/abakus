import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { CATEGORY_COLORS, formatValue, type ChartViewMode } from '../../lib/chartMeta'
import { ChartCardShell } from './LineChartCard'
import type { BarChart as BarChartData } from '../../lib/api'
import { downloadCSV, multiGeoBinRows } from '../../lib/download'

interface Props {
  title: string
  geographies: { geoid: string; label: string }[]
  charts: Record<string, BarChartData>
  viewMode?: ChartViewMode
}

// Small-multiple version of BinBarChartCard for Comparative Analysis /
// Regional Analysis "Separated" -- one mini per-bin bar chart per
// geography, all using their own most-recent year (same request range, so
// normally the same year across geographies).
export default function MultiGeoBinBarChartCard({ title, geographies, charts, viewMode = 'percent' }: Props) {
  const showCount = viewMode === 'count'
  const format = showCount ? 'count' : 'percent'

  const categoriesByGeoid = Object.fromEntries(
    geographies.map((g) => [g.geoid, (showCount ? charts[g.geoid]?.raw_categories : charts[g.geoid]?.categories) ?? {}])
  )

  return (
    <ChartCardShell title={title} onDownload={() => downloadCSV(`${title}.csv`, multiGeoBinRows(geographies, categoriesByGeoid))}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {geographies.map((g) => {
          const categories = showCount ? charts[g.geoid]?.raw_categories : charts[g.geoid]?.categories
          const years = categories ? Object.keys(categories) : []
          const year = years[years.length - 1]
          const data = year ? Object.entries(categories![year]).map(([bin, value]) => ({ bin, value })) : []
          return (
            <div key={g.geoid} className="flex flex-col items-center">
              <p className="text-xs text-abakus-light-grey mb-1 text-center truncate w-full" title={g.label}>
                {g.label}
                {year ? ` (${year})` : ''}
              </p>
              {data.length === 0 ? (
                <p className="text-xs text-abakus-light-grey/60">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={data} margin={{ top: 4, right: 4, bottom: 30, left: 4 }}>
                    <XAxis dataKey="bin" tick={{ fontSize: 8 }} angle={-40} textAnchor="end" interval={0} height={50} />
                    <YAxis hide domain={showCount ? undefined : [0, 1]} />
                    <Tooltip formatter={(v) => formatValue(Number(v), format)} />
                    <Bar dataKey="value">
                      {data.map((_, i) => (
                        <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          )
        })}
      </div>
    </ChartCardShell>
  )
}
