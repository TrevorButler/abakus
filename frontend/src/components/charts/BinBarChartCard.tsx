import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { CATEGORY_COLORS, formatValue, type ValueFormat } from '../../lib/chartMeta'
import { ChartCardShell } from './LineChartCard'

interface Props {
  title: string
  format: ValueFormat
  categories: Record<string, Record<string, number>>
}

// One bar per bin (not stacked) -- for Year Built / Year Moved In, where the
// bins are themselves what's being compared, not slices of a whole. Backend
// restricts these to a single most-recent year, so there's exactly one
// year's worth of bins to plot along the X axis.
export default function BinBarChartCard({ title, format, categories }: Props) {
  const years = Object.keys(categories)
  if (years.length === 0) {
    return <ChartCardShell title={title}>No data for this range.</ChartCardShell>
  }
  const year = years[years.length - 1]
  const data = Object.entries(categories[year]).map(([bin, value]) => ({ bin, value }))

  return (
    <ChartCardShell title={title}>
      <p className="text-xs text-abakus-light-grey mb-1">{year}</p>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 50, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e4e7" />
          <XAxis dataKey="bin" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} height={70} />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => formatValue(v, format)}
            width={55}
            domain={format === 'percent' ? [0, 1] : undefined}
            ticks={format === 'percent' ? [0, 0.25, 0.5, 0.75, 1] : undefined}
          />
          <Tooltip formatter={(v: number) => formatValue(v, format)} />
          <Bar dataKey="value">
            {data.map((_, i) => (
              <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCardShell>
  )
}
