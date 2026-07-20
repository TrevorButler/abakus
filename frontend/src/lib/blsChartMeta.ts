// BLS chart titles/formats are derived, not a static dict like ACS's
// CHART_META -- chart keys are dynamic (one employment/wage/avg-pay trend
// per user-toggled sector, e.g. "employment_trend_51"), since sectors are
// selectable at request time rather than a fixed 27-chart set.

import { NAICS_SECTORS } from './api'
import type { ValueFormat } from './chartMeta'

const SECTOR_LABELS: Record<string, string> = Object.fromEntries(NAICS_SECTORS.map((s) => [s.code, s.label]))

export interface BlsChartMeta {
  title: string
  format: ValueFormat
}

export function blsChartMeta(key: string): BlsChartMeta {
  if (key === 'employment_by_sector') return { title: 'Employment by Sector', format: 'count' }
  // Average pay per employee, not raw total dollar wages -- comparing
  // total payroll across sectors just showed whichever sectors have the
  // most total headcount, not compensation levels, which is what this
  // combined view is actually meant to answer.
  if (key === 'avg_pay_by_sector') return { title: 'Average Pay by Sector', format: 'dollars' }
  // QCEW's real "Total, All Industries" row (own_code='0') -- not a sum of
  // the 20 tracked sectors above, independent of sector selection.
  if (key === 'total_employment_trend') return { title: 'Total Jobs (All Industries)', format: 'count' }
  if (key === 'total_avg_pay_trend') return { title: 'Average Pay (All Industries)', format: 'dollars' }

  const trendMatch = key.match(/^(employment|wage|avg_pay)_trend_([\d-]+)$/)
  if (trendMatch) {
    const [, metric, code] = trendMatch
    const sector = SECTOR_LABELS[code] ?? code
    if (metric === 'employment') return { title: `${sector} -- Employment`, format: 'count' }
    if (metric === 'wage') return { title: `${sector} -- Total Wages`, format: 'dollars' }
    return { title: `${sector} -- Average Annual Pay`, format: 'dollars' }
  }

  return { title: key, format: 'count' }
}
