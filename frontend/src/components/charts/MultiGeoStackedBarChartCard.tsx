import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { CATEGORY_COLORS, formatValue, type ChartViewMode } from '../../lib/chartMeta'
import { ChartCardShell } from './LineChartCard'
import type { StackedBarChart as StackedBarChartData } from '../../lib/api'
import { downloadCSV, multiGeoCategoriesRows } from '../../lib/download'

interface Props {
  title: string
  geographies: { geoid: string; label: string }[]
  charts: Record<string, StackedBarChartData>
  startYear: number
  endYear: number
  viewMode?: ChartViewMode
}

// Some charts (e.g. Owner Cost Burden) have no resolvable data for the
// earliest few requested years -- a handful of DP04 sections had genuinely
// ambiguous labels in 2010-2012 (see demographics_dashboard.py) that leave
// those years unrecoverable. If the exact requested year is missing across
// every geography, fall back to the nearest year that actually has data
// (searching forward from a start year, backward from an end year) rather
// than silently showing nothing -- the X axis's own tick label then makes
// the substitution visible without needing separate UI for it.
function resolveYear(
  requestedYear: number,
  geographies: { geoid: string }[],
  charts: Record<string, StackedBarChartData>,
  direction: 'forward' | 'backward'
): number {
  const requested = String(requestedYear)
  if (geographies.some((g) => charts[g.geoid]?.categories[requested])) return requestedYear

  const allYears = new Set<number>()
  geographies.forEach((g) => Object.keys(charts[g.geoid]?.categories ?? {}).forEach((y) => allYears.add(Number(y))))
  const sorted = Array.from(allYears).sort((a, b) => a - b)

  if (direction === 'forward') {
    const candidates = sorted.filter((y) => y >= requestedYear)
    return candidates.length > 0 ? candidates[0] : requestedYear
  }
  const candidates = sorted.filter((y) => y <= requestedYear)
  return candidates.length > 0 ? candidates[candidates.length - 1] : requestedYear
}

// Per the UX outline: with up to 6 geographies and several categories each,
// showing every year would be unreadable, so comparative mode restricts
// category breakdowns to the two endpoint years -- rendered as one small
// stacked-bar chart per geography rather than one giant combined chart.
export default function MultiGeoStackedBarChartCard({ title, geographies, charts, startYear, endYear, viewMode = 'percent' }: Props) {
  const resolvedStartYear = resolveYear(startYear, geographies, charts, 'forward')
  const resolvedEndYear = resolveYear(endYear, geographies, charts, 'backward')
  const years = [String(resolvedStartYear), String(resolvedEndYear)].filter((y, i, arr) => arr.indexOf(y) === i)
  const showCount = viewMode === 'count'
  const format = showCount ? 'count' : 'percent'

  const categoryNames = Array.from(
    new Set(
      geographies.flatMap((g) => years.flatMap((y) => Object.keys(charts[g.geoid]?.categories[y] ?? {})))
    )
  )

  const categoriesByGeoid = Object.fromEntries(
    geographies.map((g) => [g.geoid, (showCount ? charts[g.geoid]?.raw_categories : charts[g.geoid]?.categories) ?? {}])
  )

  return (
    <ChartCardShell
      title={title}
      onDownload={() => downloadCSV(`${title}.csv`, multiGeoCategoriesRows(geographies, categoriesByGeoid, years))}
    >
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
                    <Tooltip formatter={(v) => formatValue(Number(v), format)} />
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
