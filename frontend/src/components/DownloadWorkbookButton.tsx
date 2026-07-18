import { useState } from 'react'
import { downloadFromResponse } from '../lib/download'

interface Props {
  filename: string
  chartKeys: string[]
  titleFor: (key: string) => string
  fetchWorkbook: (selectedKeys: string[]) => Promise<Blob>
}

// Chart-bearing sibling of DownloadSheetsButton -- same "choose datasets"
// checklist UX, but backed by a server-side openpyxl export (a real
// network call that can fail) instead of a synchronous client-side build,
// so this needs loading/error state DownloadSheetsButton never did.
export default function DownloadWorkbookButton({ filename, chartKeys, titleFor, fetchWorkbook }: Props) {
  const [open, setOpen] = useState(false)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(key: string) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selected = chartKeys.filter((k) => !excluded.has(k))

  function handleDownload() {
    setLoading(true)
    setError(null)
    fetchWorkbook(selected)
      .then((blob) => {
        downloadFromResponse(blob, filename)
        setOpen(false)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="bg-abakus-charcoal text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity"
      >
        Download Data
      </button>

      {open && (
        <div className="mt-3 w-full max-w-md bg-white border border-abakus-charcoal/10 rounded-xl p-4 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-abakus-charcoal">
              Choose datasets ({selected.length}/{chartKeys.length})
            </p>
            <div className="flex gap-3 text-xs">
              <button type="button" onClick={() => setExcluded(new Set())} className="text-abakus-blue hover:underline">
                All
              </button>
              <button
                type="button"
                onClick={() => setExcluded(new Set(chartKeys))}
                className="text-abakus-blue hover:underline"
              >
                None
              </button>
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto flex flex-col gap-1 mb-4">
            {chartKeys.map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm text-abakus-charcoal py-0.5">
                <input type="checkbox" checked={!excluded.has(key)} onChange={() => toggle(key)} />
                {titleFor(key)}
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={handleDownload}
            disabled={selected.length === 0 || loading}
            className="w-full bg-abakus-green text-white font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {loading ? 'Generating...' : `Download ${selected.length} Dataset${selected.length === 1 ? '' : 's'}`}
          </button>
          {error && <p className="text-abakus-warm-400 text-sm text-center mt-2">{error}</p>}
        </div>
      )}
    </div>
  )
}
