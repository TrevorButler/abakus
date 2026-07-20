import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CostarPropertyClass } from '../lib/api'
import CostarMarketUploader, { newMarket, type MarketState } from '../components/CostarMarketUploader'
import { downloadFromResponse } from '../lib/download'

export default function CostarMarketOverview() {
  const [markets, setMarkets] = useState<MarketState[]>([newMarket()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

      <CostarMarketUploader markets={markets} onChange={setMarkets} />

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
