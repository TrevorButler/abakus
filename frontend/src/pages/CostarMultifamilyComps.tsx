import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import MultiFileUploader, { type UploadItem } from '../components/MultiFileUploader'
import { downloadFromResponse } from '../lib/download'

const MAX_COMPS = 12

export default function CostarMultifamilyComps() {
  const [items, setItems] = useState<UploadItem[]>([{ id: crypto.randomUUID(), name: '', file: null }])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = items.filter((it) => it.name.trim() && it.file)
  const canGenerate = ready.length > 0

  function generate() {
    if (!canGenerate) return
    setLoading(true)
    setError(null)
    api.costar
      .multifamilyComps(ready.map((it) => ({ name: it.name.trim(), file: it.file as File })))
      .then((blob) => downloadFromResponse(blob, 'Multifamily Comps.xlsx'))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-12 gap-6">
      <div className="text-center max-w-lg">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-2">Multifamily Comps</h1>
        <p className="text-abakus-light-grey">
          Name each comp and upload its CoStar Unit Mix export. You'll get back a Unit Type Summary and a Comp
          Summary with bubble and range-scatter charts.
        </p>
      </div>

      <div className="w-full max-w-lg bg-white rounded-xl border border-abakus-charcoal/10 p-6 flex flex-col gap-4">
        <MultiFileUploader items={items} onChange={setItems} maxItems={MAX_COMPS} namePlaceholder="Property name" accept=".xlsx,.xls" />
        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate || loading}
          className="bg-abakus-orange text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 self-center"
        >
          {loading ? 'Generating...' : 'Generate Workbook'}
        </button>
        {error && <p className="text-abakus-warm-400 text-sm text-center">{error}</p>}
      </div>

      <Link to="/costar" className="text-abakus-blue hover:underline text-sm mt-auto">
        Back to mode selection
      </Link>
    </div>
  )
}
