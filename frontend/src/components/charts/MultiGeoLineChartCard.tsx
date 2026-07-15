import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { formatValue, CATEGORY_COLORS, type ValueFormat } from '../../lib/chartMeta'
import { ChartCardShell } from './LineChartCard'
import type { LineChart as LineChartData } from '../../lib/api'

interface Props {
  title: string
  format: ValueFormat
  geographies: { geoid: string; label: string }[]
  charts: Record<string, LineChartData>
}

// One line per geography, all years -- per the UX outline, line charts stay
// full-range in comparative mode even though stacked bars get restricted to
// two endpoint years (see MultiGeoStackedBarChartCard).
export default function MultiGeoLineChartCard({ title, format, geographies, charts }: Props) {
  const years = Array.from(new Set(geographies.flatMap((g) => Object.keys(charts[g.geoid]?.series ?? {})))).sort()
  if (years.length === 0) {
    return <ChartCardShell title={title}>No data for this range.</ChartCardShell>
  }

  const data = years.map((year) => {
    const row: Record<string, number | string> = { year }
    for (const g of geographies) {
      const v = charts[g.geoid]?.series[year]
      if (v !== undefined) row[g.geoid] = v
    }
    return row
  })

  return (
    <ChartCardShell title={title}>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e4e7" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatValue(v, format)} width={70} />
          <Tooltip formatter={(v: number) => formatValue(v, format)} />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(geoid) => geographies.find((g) => g.geoid === geoid)?.label ?? geoid} />
          {geographies.map((g, i) => (
            <Line
              key={g.geoid}
              type="monotone"
              dataKey={g.geoid}
              stroke={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 2 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCardShell>
  )
}
