import type { ReactNode } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatValue, type ValueFormat } from '../../lib/chartMeta'

interface Props {
  title: string
  format: ValueFormat
  series: Record<string, number>
}

export default function LineChartCard({ title, format, series }: Props) {
  const data = Object.entries(series)
    .map(([year, value]) => ({ year: Number(year), value }))
    .sort((a, b) => a.year - b.year)

  if (data.length === 0) {
    return <ChartCardShell title={title}>No data for this range.</ChartCardShell>
  }

  return (
    <ChartCardShell title={title}>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e4e7" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatValue(v, format)} width={70} />
          <Tooltip formatter={(v: number) => formatValue(v, format)} labelFormatter={(y) => `${y}`} />
          <Line type="monotone" dataKey="value" stroke="#36bfee" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCardShell>
  )
}

export function ChartCardShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-abakus-charcoal/10 p-4">
      <h3 className="text-sm font-medium text-abakus-charcoal mb-2">{title}</h3>
      {children}
    </div>
  )
}
