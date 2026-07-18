// BLS chart titles/formats are derived, not a static dict like ACS's
// CHART_META -- chart keys are dynamic (one employment/wage/avg-pay trend
// per user-toggled sector, e.g. "employment_trend_51"), since sectors are
// selectable at request time rather than a fixed 27-chart set.

import { NAICS_SECTORS, type BlsDashboardResult } from './api'
import type { ValueFormat } from './chartMeta'
import { seriesRows, type SheetData } from './download'

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

// BLS-specific sheet builder -- separate from lib/download.ts's
// dashboardSheets() since that one is typed against ACS's ChartResult
// union (line/stacked_bar/bar), which has no "multi_line" case. Wide
// format (Year down rows, one column per sector) matches the existing
// multi-variable export convention used elsewhere in the app.
export function blsDashboardSheets(dashboard: BlsDashboardResult, titleFor: (key: string) => string): SheetData[] {
  return Object.entries(dashboard).map(([key, chart]) => {
    const title = titleFor(key)
    if (chart.chart_type === 'line') return { name: title, rows: seriesRows(title, chart.series) }

    const labels = Object.keys(chart.series_by_label)
    const years = Array.from(new Set(labels.flatMap((l) => Object.keys(chart.series_by_label[l])))).sort()
    const rows: (string | number)[][] = [
      ['Year', ...labels],
      ...years.map((y) => [y, ...labels.map((l) => chart.series_by_label[l][y] ?? '')]),
    ]
    return { name: title, rows }
  })
}

// "Separated" comparative view equivalent -- per chart key, either a
// standard multi-geo line sheet (line charts) or a Geography+Year-keyed
// wide sheet (multi_line charts, one column per sector).
export function blsMultiGeoDashboardSheets(
  geographies: { geoid: string; label: string }[],
  dataByGeoid: Record<string, BlsDashboardResult>,
  chartNames: string[],
  titleFor: (key: string) => string
): SheetData[] {
  const sheets: SheetData[] = []

  for (const key of chartNames) {
    const firstResult = dataByGeoid[geographies[0]?.geoid]?.[key]
    if (!firstResult) continue
    const title = titleFor(key)

    if (firstResult.chart_type === 'line') {
      const rows: (string | number)[][] = [
        ['Geography', 'Year', title],
        ...geographies.flatMap((g) => {
          const series = dataByGeoid[g.geoid]?.[key]
          if (series?.chart_type !== 'line') return []
          return Object.entries(series.series).map(([y, v]) => [g.label, y, v])
        }),
      ]
      sheets.push({ name: title, rows })
      continue
    }

    const allLabels = Array.from(
      new Set(
        geographies.flatMap((g) => {
          const chart = dataByGeoid[g.geoid]?.[key]
          return chart?.chart_type === 'multi_line' ? Object.keys(chart.series_by_label) : []
        })
      )
    )
    const rows: (string | number)[][] = [
      ['Geography', 'Year', ...allLabels],
      ...geographies.flatMap((g) => {
        const chart = dataByGeoid[g.geoid]?.[key]
        if (chart?.chart_type !== 'multi_line') return []
        const years = Array.from(new Set(allLabels.flatMap((l) => Object.keys(chart.series_by_label[l] ?? {})))).sort()
        return years.map((y) => [g.label, y, ...allLabels.map((l) => chart.series_by_label[l]?.[y] ?? '')])
      }),
    ]
    sheets.push({ name: title, rows })
  }

  return sheets
}
