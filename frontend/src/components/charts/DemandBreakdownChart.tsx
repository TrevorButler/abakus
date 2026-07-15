import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { CATEGORY_COLORS, formatValue } from '../../lib/chartMeta'
import { ChartCardShell } from './LineChartCard'
import type { AgeIncomeCell } from '../../lib/api'
import { downloadCSV, ageIncomeRows } from '../../lib/download'

interface Props {
  title: string
  cells: AgeIncomeCell[]
}

// Age x income joint distribution of projected demand, as a single stacked
// bar (one segment per income bin, one bar per age group) -- unlike
// StackedBarChartCard this plots absolute demand counts, not percentages,
// since the age/income shares have already been folded into demand_total.
export default function DemandBreakdownChart({ title, cells }: Props) {
  if (cells.length === 0) {
    return <ChartCardShell title={title}>No data for this range.</ChartCardShell>
  }

  const ageGroups = Array.from(new Set(cells.map((c) => c.age_group)))
  const incomeBins = Array.from(new Set(cells.map((c) => c.income_bin)))

  const data = ageGroups.map((ageGroup) => {
    const row: Record<string, string | number> = { age_group: ageGroup }
    for (const cell of cells.filter((c) => c.age_group === ageGroup)) {
      row[cell.income_bin] = cell.demand
    }
    return row
  })

  return (
    <ChartCardShell title={title} onDownload={() => downloadCSV(`${title}.csv`, ageIncomeRows(cells))}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e4e7" />
          <XAxis dataKey="age_group" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatValue(v, 'count')} width={60} />
          <Tooltip formatter={(v: number) => formatValue(v, 'count')} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {incomeBins.map((bin, i) => (
            <Bar key={bin} dataKey={bin} stackId="a" fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCardShell>
  )
}
