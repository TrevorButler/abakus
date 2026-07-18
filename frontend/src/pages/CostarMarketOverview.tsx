import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CostarPropertyClass } from '../lib/api'
import FileUploadSlot from '../components/FileUploadSlot'
import { downloadFromResponse } from '../lib/download'

const MAX_MARKETS = 6

const CLASS_OPTIONS: { key: CostarPropertyClass; label: string }[] = [
  { key: 'multifamily', label: 'Multifamily' },
  { key: 'retail', label: 'Retail' },
  { key: 'office', label: 'Office' },
  { key: 'industrial_flex', label: 'Industrial & Flex' },
  { key: 'hospitality', label: 'Hospitality' },
]

interface MarketState {
  id: string
  name: string
  files: Partial<Record<CostarPropertyClass, File | null>>
}

function newMarket(): MarketState {
  return { id: crypto.randomUUID(), name: '', files: {} }
}

// Fixed matrix (up to 6 markets x 5 optional property-class uploads), not
// MultiFileUploader's open-ended list -- markets aren't required to upload
// every class, per the confirmed requirement, so each market card just
// shows all 5 slots with whichever ones the user fills in.
export default function CostarMarketOverview() {
  const [markets, setMarkets] = useState<MarketState[]>([newMarket()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateMarket(id: string, patch: Partial<MarketState>) {
    setMarkets((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  function setMarketFile(id: string, cls: CostarPropertyClass, file: File | null) {
    setMarkets((prev) => prev.map((m) => (m.id === id ? { ...m, files: { ...m.files, [cls]: file } } : m)))
  }

  function addMarket() {
    if (markets.length >= MAX_MARKETS) return
    setMarkets((prev) => [...prev, newMarket()])
  }

  function removeMarket(id: string) {
    setMarkets((prev) => prev.filter((m) => m.id !== id))
  }

  const readyMarkets = markets.filter((m) => m.name.trim() && Object.values(m.files).some((f) => f))
  const canGenerate = readyMarkets.length > 0

  function generate() {
    if (!canGenerate) return
    setLoading(true)
    setError(null)
    const payload = readyMarkets.map((m) => ({
      name: m.name.trim(),
      files: Object.fromEntries(Object.entries(m.files).filter(([, f]) => f)) as Partial<Record<CostarPropertyClass, File>>,
    }))
    api.costar
      .marketOverview(payload)
      .then((blob) => downloadFromResponse(blob, 'Market Overview.xlsx'))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-12 gap-6">
      <div className="text-center max-w-lg">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-2">Market Overview &amp; Comparison</h1>
        <p className="text-abakus-light-grey">
          Name each market and upload whichever CoStar data grid exports you have for it -- not every market needs
          every property class. The output has one tab per property class, comparing every market that uploaded it.
        </p>
      </div>

      <div className="w-full max-w-[1400px] overflow-x-auto">
        <div className="flex gap-4 pb-2" style={{ minWidth: `${markets.length * 280}px` }}>
          {markets.map((market, i) => (
            <div key={market.id} className="flex flex-col gap-3 bg-white rounded-xl border border-abakus-charcoal/10 p-4 w-[260px] shrink-0">
              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={market.name}
                  onChange={(e) => updateMarket(market.id, { name: e.target.value })}
                  placeholder={`Market ${i + 1} name`}
                  className="border border-abakus-charcoal/20 rounded-lg px-3 py-2 bg-white text-sm w-full"
                />
                {markets.length > 1 && (
                  <button type="button" onClick={() => removeMarket(market.id)} className="text-abakus-warm-400 text-xs hover:underline shrink-0">
                    Remove
                  </button>
                )}
              </div>
              {CLASS_OPTIONS.map((cls) => (
                <div key={cls.key} className="flex flex-col gap-1">
                  <span className="text-xs text-abakus-light-grey">{cls.label}</span>
                  <FileUploadSlot
                    file={market.files[cls.key] ?? null}
                    onFileChange={(f) => setMarketFile(market.id, cls.key, f)}
                    accept=".xlsx,.xls"
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {markets.length < MAX_MARKETS && (
        <button type="button" onClick={addMarket} className="text-abakus-blue hover:underline text-sm">
          + Add another market ({markets.length}/{MAX_MARKETS})
        </button>
      )}

      <button
        type="button"
        onClick={generate}
        disabled={!canGenerate || loading}
        className="bg-abakus-pink text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {loading ? 'Generating...' : 'Generate Workbook'}
      </button>
      {error && <p className="text-abakus-warm-400 text-sm text-center">{error}</p>}

      <Link to="/costar" className="text-abakus-blue hover:underline text-sm mt-auto">
        Back to mode selection
      </Link>
    </div>
  )
}
