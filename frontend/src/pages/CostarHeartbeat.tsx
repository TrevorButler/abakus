import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import FileUploadSlot from '../components/FileUploadSlot'
import { downloadFromResponse } from '../lib/download'

export default function CostarHeartbeat() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function generate() {
    if (!file) return
    setLoading(true)
    setError(null)
    api.costar
      .heartbeat(file)
      .then((blob) => downloadFromResponse(blob, 'Heartbeat.xlsx'))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-12 gap-6">
      <div className="text-center max-w-lg">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-2">Heartbeat</h1>
        <p className="text-abakus-light-grey">
          Upload a CoStar property list export. You'll get back a workbook with the properties cleaned into broad
          classes and decades, a development-by-status summary, and an SF-over-time chart per class.
        </p>
      </div>

      <div className="w-full max-w-lg bg-white rounded-xl border border-abakus-charcoal/10 p-6 flex flex-col items-center gap-4">
        <FileUploadSlot file={file} onFileChange={setFile} accept=".xlsx,.xls" />
        <button
          type="button"
          onClick={generate}
          disabled={!file || loading}
          className="bg-abakus-blue text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
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
