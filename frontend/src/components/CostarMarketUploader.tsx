import FileUploadSlot from './FileUploadSlot'
import { type CostarPropertyClass } from '../lib/api'

export const MAX_MARKETS = 6

const CLASS_OPTIONS: { key: CostarPropertyClass; label: string }[] = [
  { key: 'multifamily', label: 'Multifamily' },
  { key: 'retail', label: 'Retail' },
  { key: 'office', label: 'Office' },
  { key: 'industrial_flex', label: 'Industrial & Flex' },
  { key: 'hospitality', label: 'Hospitality' },
]

export interface MarketState {
  id: string
  name: string
  files: Partial<Record<CostarPropertyClass, File | null>>
}

export function newMarket(namePrefill = ''): MarketState {
  return { id: crypto.randomUUID(), name: namePrefill, files: {} }
}

interface Props {
  markets: MarketState[]
  onChange: (markets: MarketState[]) => void
}

// Extracted from CostarMarketOverview.tsx so the same fixed matrix (up to 6
// markets x 5 optional property-class uploads) can be reused by the master
// module's CoStar step -- markets aren't required to upload every class,
// per the confirmed requirement, so each market card just shows all 5
// slots with whichever ones the user fills in.
export default function CostarMarketUploader({ markets, onChange }: Props) {
  function updateMarket(id: string, patch: Partial<MarketState>) {
    onChange(markets.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }

  function setMarketFile(id: string, cls: CostarPropertyClass, file: File | null) {
    onChange(markets.map((m) => (m.id === id ? { ...m, files: { ...m.files, [cls]: file } } : m)))
  }

  function addMarket() {
    if (markets.length >= MAX_MARKETS) return
    onChange([...markets, newMarket()])
  }

  function removeMarket(id: string) {
    onChange(markets.filter((m) => m.id !== id))
  }

  return (
    <div className="flex flex-col items-center gap-3 w-full">
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
    </div>
  )
}
