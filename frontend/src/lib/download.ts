import * as XLSX from 'xlsx'

// Shared by every chart's per-chart CSV download button, plus
// HousingDemand.tsx/BlsOfficeDemand.tsx's hand-built "Download Data"
// workbooks (those two pages aren't chart-union-shaped, so they don't go
// through DownloadWorkbookButton's server-side export). Everything here
// happens client-side against data already sitting in the page.

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

// CoStar/SmartRE modules generate their workbook server-side (openpyxl, for
// native editable charts) and return the raw file -- this just triggers the
// browser download for a Blob the frontend didn't build itself, same
// mechanics as triggerDownload above.
export function downloadFromResponse(blob: Blob, filename: string) {
  triggerDownload(blob, filename)
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
  const bins = Object.keys(data ?? {})
  return [['Year', ...bins], [year ?? '', ...bins.map((b) => data![b])]]
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

// Wide format: one row per (Geography, Year), one column per category --
// mirrors categoriesRows()'s single-geo shape with a Geography column
// prepended. Category set can vary across geographies/years (a bin with no
// data somewhere), so the column list is the union across everything,
// stable-ordered by first appearance.
export function multiGeoCategoriesRows(
  geographies: { geoid: string; label: string }[],
  categoriesByGeoid: Record<string, Record<string, Record<string, number>>>,
  years: string[]
): (string | number)[][] {
  const categoryNames: string[] = []
  const seen = new Set<string>()
  for (const g of geographies) {
    const cats = categoriesByGeoid[g.geoid] ?? {}
    for (const y of years) {
      Object.keys(cats[y] ?? {}).forEach((c) => {
        if (!seen.has(c)) {
          seen.add(c)
          categoryNames.push(c)
        }
      })
    }
  }

  const rows: (string | number)[][] = [['Geography', 'Year', ...categoryNames]]
  for (const g of geographies) {
    const cats = categoriesByGeoid[g.geoid] ?? {}
    for (const y of years) {
      const yearCats = cats[y]
      if (!yearCats) continue
      rows.push([g.label, y, ...categoryNames.map((c) => yearCats[c] ?? '')])
    }
  }
  return rows
}


// Wide format: one row per geography, one column per bin (each geography's
// own most-recent year, same convention as MultiGeoBinBarChartCard).
export function multiGeoBinRows(
  geographies: { geoid: string; label: string }[],
  categoriesByGeoid: Record<string, Record<string, Record<string, number>>>
): (string | number)[][] {
  const bins: string[] = []
  const seen = new Set<string>()
  const yearByGeoid: Record<string, string | undefined> = {}
  for (const g of geographies) {
    const cats = categoriesByGeoid[g.geoid] ?? {}
    const years = Object.keys(cats)
    const year = years[years.length - 1]
    yearByGeoid[g.geoid] = year
    if (!year) continue
    Object.keys(cats[year]).forEach((b) => {
      if (!seen.has(b)) {
        seen.add(b)
        bins.push(b)
      }
    })
  }

  const rows: (string | number)[][] = [['Geography', 'Year', ...bins]]
  for (const g of geographies) {
    const year = yearByGeoid[g.geoid]
    if (!year) continue
    const data = categoriesByGeoid[g.geoid][year]
    rows.push([g.label, year, ...bins.map((b) => data[b] ?? '')])
  }
  return rows
}
