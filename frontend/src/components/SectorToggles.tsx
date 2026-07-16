import { BLS_SECTORS } from '../lib/api'

interface Props {
  selected: string[]
  onChange: (codes: string[]) => void
}

// Shared sector-selection checkbox row -- default all on, used by both
// BlsDashboard and BlsComparative.
export default function SectorToggles({ selected, onChange }: Props) {
  function toggle(code: string) {
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code])
  }

  return (
    <div className="flex flex-wrap gap-2 justify-center max-w-2xl">
      {BLS_SECTORS.map((sector) => {
        const active = selected.includes(sector.code)
        return (
          <button
            key={sector.code}
            type="button"
            onClick={() => toggle(sector.code)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              active
                ? 'bg-abakus-charcoal text-white border-abakus-charcoal'
                : 'bg-white text-abakus-light-grey border-abakus-charcoal/20 hover:bg-abakus-cream'
            }`}
          >
            {sector.label}
          </button>
        )
      })}
    </div>
  )
}
