import type { ReactNode } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatValue, type ValueFormat } from '../../lib/chartMeta'
import { downloadCSV, seriesRows } from '../../lib/download'

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
    <ChartCardShell title={title} onDownload={() => downloadCSV(`${title}.csv`, seriesRows(title, series))}>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e4e7" />
          <XAxis dataKey="year" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatValue(v, format)} width={70} />
          <Tooltip formatter={(v) => formatValue(Number(v), format)} labelFormatter={(y) => `${y}`} />
          <Line type="monotone" dataKey="value" stroke="#36bfee" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCardShell>
  )
}

export function ChartCardShell({ title, children, onDownload }: { title: string; children: ReactNode; onDownload?: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-abakus-charcoal/10 p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium text-abakus-charcoal">{title}</h3>
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            title="Download chart data"
            aria-label="Download chart data"
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full border border-abakus-charcoal/20 text-abakus-charcoal/50 hover:bg-abakus-cream hover:text-abakus-charcoal transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16" />
            </svg>
          </button>
        )}
      </div>
      {children}
    </div>
  )
}
