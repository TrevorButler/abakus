import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import MultiFileUploader, { type UploadItem } from '../components/MultiFileUploader'
import { downloadFromResponse } from '../lib/download'

const MAX_FILES = 20

// The "Live Environment" flow from the doc: upload -> load the distinct
// subdivisions present -> pick a comp set -> generate. Files stay in
// browser memory (never cached server-side) so the second request can
// re-send them without asking the user to upload twice.
export default function SmartReSalesAnalysis() {
  const [items, setItems] = useState<UploadItem[]>([{ id: crypto.randomUUID(), name: '', file: null }])
  const [subdivisions, setSubdivisions] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [loadingSubs, setLoadingSubs] = useState(false)
  const [loadingGen, setLoadingGen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const files = items.map((it) => it.file).filter((f): f is File => f !== null)

  const filteredSubdivisions = useMemo(() => {
    if (!subdivisions) return []
    const q = filter.trim().toLowerCase()
    return q ? subdivisions.filter((s) => s.toLowerCase().includes(q)) : subdivisions
  }, [subdivisions, filter])

  function handleItemsChange(next: UploadItem[]) {
    setItems(next)
    setSubdivisions(null)
    setSelected([])
  }

  function loadSubdivisions() {
    if (files.length === 0) return
    setLoadingSubs(true)
    setError(null)
    api.smartre
      .listSubdivisions(files)
      .then((res) => {
        setSubdivisions(res.subdivisions)
        setSelected([])
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingSubs(false))
  }

  function toggleSubdivision(s: string) {
    setSelected((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  function generate() {
    if (selected.length === 0) return
    setLoadingGen(true)
    setError(null)
    api.smartre
      .salesAnalysis(files, selected)
      .then((blob) => downloadFromResponse(blob, 'SmartRE Sales Analysis.xlsx'))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingGen(false))
  }

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-12 gap-6">
      <div className="text-center max-w-lg">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-2">SmartRE Sales Analysis</h1>
        <p className="text-abakus-light-grey">
          Upload up to 20 SmartRE sales downloads (SmartRE caps each export at 1,000 rows, so multiple files are
          often needed), then pick a comp set of subdivisions to analyze.
        </p>
      </div>

      <div className="w-full max-w-lg bg-white rounded-xl border border-abakus-charcoal/10 p-6 flex flex-col gap-4">
        <MultiFileUploader items={items} onChange={handleItemsChange} maxItems={MAX_FILES} withNames={false} accept=".xlsx,.xls,.csv" />
        <button
          type="button"
          onClick={loadSubdivisions}
          disabled={files.length === 0 || loadingSubs}
          className="bg-abakus-blue text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 self-center"
        >
          {loadingSubs ? 'Loading...' : 'Load Subdivisions'}
        </button>
      </div>

      {subdivisions && (
        <div className="w-full max-w-lg bg-white rounded-xl border border-abakus-charcoal/10 p-6 flex flex-col gap-3">
          <p className="text-sm text-abakus-light-grey text-center">
            {selected.length} selected of {subdivisions.length} subdivisions found
          </p>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter subdivisions..."
            className="border border-abakus-charcoal/20 rounded-lg px-3 py-2 bg-white text-sm"
          />
          <div className="max-h-72 overflow-y-auto border border-abakus-charcoal/10 rounded-lg divide-y divide-abakus-charcoal/5">
            {filteredSubdivisions.map((s) => (
              <label key={s} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-abakus-cream cursor-pointer">
                <input type="checkbox" checked={selected.includes(s)} onChange={() => toggleSubdivision(s)} />
                <span>{s}</span>
              </label>
            ))}
            {filteredSubdivisions.length === 0 && <p className="text-xs text-abakus-light-grey/70 text-center py-4">No matches.</p>}
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={selected.length === 0 || loadingGen}
            className="bg-abakus-green text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 self-center"
          >
            {loadingGen ? 'Generating...' : 'Generate Workbook'}
          </button>
        </div>
      )}

      {error && <p className="text-abakus-warm-400 text-sm text-center">{error}</p>}

      <Link to="/" className="text-abakus-blue hover:underline text-sm mt-auto">
        Back to data source selection
      </Link>
    </div>
  )
}
