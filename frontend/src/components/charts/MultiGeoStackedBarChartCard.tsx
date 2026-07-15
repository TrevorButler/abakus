import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { CATEGORY_COLORS, formatValue, type ChartViewMode } from '../../lib/chartMeta'
import { ChartCardShell } from './LineChartCard'
import type { StackedBarChart as StackedBarChartData } from '../../lib/api'

interface Props {
  title: string
  geographies: { geoid: string; label: string }[]
  charts: Record<string, StackedBarChartData>
  startYear: number
  endYear: number
  viewMode?: ChartViewMode
}

// Per the UX outline: with up to 6 geographies and several categories each,
// showing every year would be unreadable, so comparative mode restricts
// category breakdowns to the two endpoint years -- rendered as one small
// stacked-bar chart per geography rather than one giant combined chart.
export default function MultiGeoStackedBarChartCard({ title, geographies, charts, startYear, endYear, viewMode = 'percent' }: Props) {
  const years = [String(startYear), String(endYear)].filter((y, i, arr) => arr.indexOf(y) === i)
  const showCount = viewMode === 'count'
  const format = showCount ? 'count' : 'percent'

  const categoryNames = Array.from(
    new Set(
      geographies.flatMap((g) => years.flatMap((y) => Object.keys(charts[g.geoid]?.categories[y] ?? {})))
    )
  )

  return (
    <ChartCardShell title={title}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {geographies.map((g) => {
          const cats = showCount ? charts[g.geoid]?.raw_categories : charts[g.geoid]?.categories
          const data = years
            .filter((y) => cats?.[y])
            .map((y) => ({ year: y, ...cats![y] }))
          return (
            <div key={g.geoid} className="flex flex-col items-center">
              <p className="text-xs text-abakus-light-grey mb-1 text-center truncate w-full" title={g.label}>
                {g.label}
              </p>
              {data.length === 0 ? (
                <p className="text-xs text-abakus-light-grey/60">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                    <YAxis hide domain={showCount ? undefined : [0, 1]} />
                    <Tooltip formatter={(v: number) => formatValue(v, format)} />
                    {categoryNames.map((name, i) => (
                      <Bar key={name} dataKey={name} stackId="a" fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                    ))}
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
