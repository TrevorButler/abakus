import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { CATEGORY_COLORS, formatValue, type ChartViewMode } from '../../lib/chartMeta'
import { ChartCardShell } from './LineChartCard'
import { downloadCSV, categoriesRows } from '../../lib/download'

interface Props {
  title: string
  categories: Record<string, Record<string, number>>
  rawCategories?: Record<string, Record<string, number>>
  viewMode?: ChartViewMode
}

export default function StackedBarChartCard({ title, categories, rawCategories, viewMode = 'percent' }: Props) {
  const showCount = viewMode === 'count' && rawCategories
  const source = showCount ? rawCategories! : categories
  const format = showCount ? 'count' : 'percent'
  const years = Object.keys(source).sort()
  if (years.length === 0) {
    return <ChartCardShell title={title}>No data for this range.</ChartCardShell>
  }

  // Category set can vary in name/order across years (e.g. a bin with no
  // data in one year) -- union them so every year gets every bar segment,
  // in a stable order.
  const categoryNames = Array.from(new Set(years.flatMap((y) => Object.keys(source[y]))))

  const data = years.map((year) => ({ year, ...source[year] }))

  return (
    <ChartCardShell title={title} onDownload={() => downloadCSV(`${title}.csv`, categoriesRows(source))}>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e4e7" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => formatValue(v, format)}
            width={showCount ? 60 : 50}
            domain={showCount ? undefined : [0, 1]}
            ticks={showCount ? undefined : [0, 0.25, 0.5, 0.75, 1]}
          />
          <Tooltip formatter={(v) => formatValue(Number(v), format)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {categoryNames.map((name, i) => (
            <Bar key={name} dataKey={name} stackId="a" fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCardShell>
  )
}
