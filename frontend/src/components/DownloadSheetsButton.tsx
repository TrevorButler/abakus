import { useState } from 'react'
import { downloadWorkbook, type SheetData } from '../lib/download'

interface Props {
  filename: string
  sheets: SheetData[]
}

// "Download Data" opens a checklist of every available dataset (all
// checked by default) so users can pull just the handful they care about
// instead of the full workbook every time.
export default function DownloadSheetsButton({ filename, sheets }: Props) {
  const [open, setOpen] = useState(false)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  function toggle(name: string) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const selected = sheets.filter((s) => !excluded.has(s.name))

  function handleDownload() {
    downloadWorkbook(filename, selected)
    setOpen(false)
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
              Choose datasets ({selected.length}/{sheets.length})
            </p>
            <div className="flex gap-3 text-xs">
              <button type="button" onClick={() => setExcluded(new Set())} className="text-abakus-blue hover:underline">
                All
              </button>
              <button
                type="button"
                onClick={() => setExcluded(new Set(sheets.map((s) => s.name)))}
                className="text-abakus-blue hover:underline"
              >
                None
              </button>
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto flex flex-col gap-1 mb-4">
            {sheets.map((s) => (
              <label key={s.name} className="flex items-center gap-2 text-sm text-abakus-charcoal py-0.5">
                <input type="checkbox" checked={!excluded.has(s.name)} onChange={() => toggle(s.name)} />
                {s.name}
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={handleDownload}
            disabled={selected.length === 0}
            className="w-full bg-abakus-green text-white font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            Download {selected.length} Dataset{selected.length === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </div>
  )
}
