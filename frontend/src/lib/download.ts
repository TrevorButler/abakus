import * as XLSX from 'xlsx'
import type { ChartResult } from './api'
import type { ChartViewMode } from './chartMeta'

// Shared by every chart's per-chart download button and each dashboard's
// "Download Data" workbook button. Everything happens client-side against
// data already sitting in the page -- no backend endpoint needed, since
// the browser already has the exact numbers being rendered (respecting
// whatever %/# view mode is currently active).

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function escapeCsvCell(cell: string | number): string {
  const s = String(cell)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename)
}

export interface SheetData {
  name: string
  rows: (string | number)[][]
}

// Excel sheet names: max 31 chars, can't contain : \ / ? * [ ], can't repeat.
function uniqueSheetName(name: string, used: Set<string>): string {
  let safe = name.replace(/[:\\/?*[\]]/g, '').slice(0, 31) || 'Sheet'
  let candidate = safe
  let i = 2
  while (used.has(candidate)) {
    const suffix = ` (${i})`
    candidate = safe.slice(0, 31 - suffix.length) + suffix
    i++
  }
  return candidate
}

export function downloadWorkbook(filename: string, sheets: SheetData[]) {
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()
  for (const sheet of sheets) {
    if (sheet.rows.length === 0) continue
    const name = uniqueSheetName(sheet.name, used)
    used.add(name)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.rows), name)
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  triggerDownload(new Blob([out], { type: 'application/octet-stream' }), filename)
}

// ============================================================
// Row builders -- one per chart data shape, reused by both the per-chart
// CSV button and the full-workbook sheet generation.
// ============================================================

export function seriesRows(label: string, series: Record<string, number>): (string | number)[][] {
  const years = Object.keys(series).map(Number).sort((a, b) => a - b)
  return [['Year', label], ...years.map((y) => [y, series[String(y)]])]
}

export function categoriesRows(categories: Record<string, Record<string, number>>): (string | number)[][] {
  const years = Object.keys(categories).sort()
  const categoryNames = Array.from(new Set(years.flatMap((y) => Object.keys(categories[y]))))
  return [['Year', ...categoryNames], ...years.map((y) => [y, ...categoryNames.map((c) => categories[y][c] ?? '')])]
}

export function binRows(categories: Record<string, Record<string, number>>): (string | number)[][] {
  const years = Object.keys(categories)
  const year = years[years.length - 1]
  const data = year ? categories[year] : {}
  return [['Bin', 'Value'], ...Object.entries(data ?? {})]
}

export function ageIncomeRows(cells: { age_group: string; income_bin: string; demand: number }[]): (string | number)[][] {
  return [['Age Group', 'Income Bin', 'Demand'], ...cells.map((c) => [c.age_group, c.income_bin, c.demand])]
}

export function multiGeoSeriesRows(
  geographies: { geoid: string; label: string }[],
  seriesByGeoid: Record<string, Record<string, number>>
): (string | number)[][] {
  const years = new Set<number>()
  geographies.forEach((g) => Object.keys(seriesByGeoid[g.geoid] ?? {}).forEach((y) => years.add(Number(y))))
  const sorted = Array.from(years).sort((a, b) => a - b)
  return [
    ['Year', ...geographies.map((g) => g.label)],
    ...sorted.map((y) => [y, ...geographies.map((g) => seriesByGeoid[g.geoid]?.[String(y)] ?? '')]),
  ]
}

// Long format (Geography, Year, Category, Value) -- a wide format gets
// unwieldy once there are several categories times several geographies.
export function multiGeoCategoriesRows(
  geographies: { geoid: string; label: string }[],
  categoriesByGeoid: Record<string, Record<string, Record<string, number>>>,
  years: string[]
): (string | number)[][] {
  const rows: (string | number)[][] = [['Geography', 'Year', 'Category', 'Value']]
  for (const g of geographies) {
    const cats = categoriesByGeoid[g.geoid] ?? {}
    for (const y of years) {
      const yearCats = cats[y]
      if (!yearCats) continue
      for (const [cat, val] of Object.entries(yearCats)) rows.push([g.label, y, cat, val])
    }
  }
  return rows
}

// Single-geo and Regional-Aggregated dashboards share the exact same
// DashboardResult shape, so both can build their "Download Data" workbook
// through this one function.
export function dashboardSheets(
  dashboard: Record<string, ChartResult>,
  titleFor: (key: string) => string,
  viewMode: ChartViewMode
): SheetData[] {
  const showCount = viewMode === 'count'
  return Object.entries(dashboard).map(([key, chart]) => {
    const title = titleFor(key)
    if (chart.chart_type === 'line') return { name: title, rows: seriesRows(title, chart.series) }
    const source = showCount ? chart.raw_categories : chart.categories
    if (chart.chart_type === 'bar') return { name: title, rows: binRows(source) }
    return { name: title, rows: categoriesRows(source) }
  })
}

// Comparative Analysis / Regional Analysis "Separated" -- one sheet per
// chart, combining every geography (long-format for category breakdowns).
// Unlike the on-screen small-multiples view (which restricts category
// breakdowns to two endpoint years for readability), the export uses every
// year actually present in the data -- that visual constraint doesn't
// apply to a spreadsheet.
export function multiGeoDashboardSheets(
  geographies: { geoid: string; label: string }[],
  dataByGeoid: Record<string, Record<string, ChartResult>>,
  chartNames: string[],
  titleFor: (key: string) => string,
  viewMode: ChartViewMode
): SheetData[] {
  const showCount = viewMode === 'count'
  const sheets: SheetData[] = []

  for (const key of chartNames) {
    const firstResult = dataByGeoid[geographies[0]?.geoid]?.[key]
    if (!firstResult) continue
    const title = titleFor(key)

    if (firstResult.chart_type === 'line') {
      const seriesByGeoid: Record<string, Record<string, number>> = {}
      geographies.forEach((g) => {
        const c = dataByGeoid[g.geoid]?.[key]
        seriesByGeoid[g.geoid] = c?.chart_type === 'line' ? c.series : {}
      })
      sheets.push({ name: title, rows: multiGeoSeriesRows(geographies, seriesByGeoid) })
      continue
    }

    const categoriesByGeoid: Record<string, Record<string, Record<string, number>>> = {}
    geographies.forEach((g) => {
      const c = dataByGeoid[g.geoid]?.[key]
      categoriesByGeoid[g.geoid] = c && c.chart_type !== 'line' ? (showCount ? c.raw_categories : c.categories) : {}
    })

    if (firstResult.chart_type === 'bar') {
      sheets.push({ name: title, rows: multiGeoBinRows(geographies, categoriesByGeoid) })
      continue
    }

    const allYears = new Set<string>()
    geographies.forEach((g) => Object.keys(categoriesByGeoid[g.geoid] ?? {}).forEach((y) => allYears.add(y)))
    sheets.push({ name: title, rows: multiGeoCategoriesRows(geographies, categoriesByGeoid, Array.from(allYears).sort()) })
  }

  return sheets
}

export function multiGeoBinRows(
  geographies: { geoid: string; label: string }[],
  categoriesByGeoid: Record<string, Record<string, Record<string, number>>>
): (string | number)[][] {
  const rows: (string | number)[][] = [['Geography', 'Year', 'Bin', 'Value']]
  for (const g of geographies) {
    const cats = categoriesByGeoid[g.geoid] ?? {}
    const years = Object.keys(cats)
    const year = years[years.length - 1]
    if (!year) continue
    for (const [bin, val] of Object.entries(cats[year])) rows.push([g.label, year, bin, val])
  }
  return rows
}
