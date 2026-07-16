import { BarChart, Bar, ErrorBar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { ChartCardShell } from './LineChartCard'
import { downloadCSV } from '../../lib/download'

export interface ErrorBarDatum {
  mean: number | null
  se: number | null
  n: number
}

interface Props {
  title: string
  data: Record<string, ErrorBarDatum>
  valueLabel?: string
}

// Mean +/- standard error per category (unit type or bedroom bucket) --
// nothing else in this app renders a statistic with a margin of error, so
// this is a genuinely new chart shape, not a reuse of an existing one.
export default function ErrorBarChartCard({ title, data, valueLabel = 'Mean' }: Props) {
  const entries = Object.entries(data).filter(([, d]) => d.mean !== null)
  if (entries.length === 0) {
    return <ChartCardShell title={title}>No data for this range.</ChartCardShell>
  }

  const chartData = entries.map(([label, d]) => ({
    label,
    mean: Number(d.mean!.toFixed(3)),
    se: d.se !== null ? Number(d.se.toFixed(3)) : 0,
    n: d.n,
  }))

  const rows: (string | number)[][] = [
    ['Category', valueLabel, 'Standard Error', 'N'],
    ...chartData.map((d) => [d.label, d.mean, d.se, d.n]),
  ]

  return (
    <ChartCardShell title={title} onDownload={() => downloadCSV(`${title}.csv`, rows)}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e4e7" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={70} />
          <YAxis tick={{ fontSize: 12 }} width={50} />
          <Tooltip formatter={(v, name) => (name === 'mean' ? [v, valueLabel] : [v, name])} />
          <Bar dataKey="mean" fill="#36bfee">
            <ErrorBar dataKey="se" width={4} strokeWidth={1.5} stroke="#262628" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCardShell>
  )
}
