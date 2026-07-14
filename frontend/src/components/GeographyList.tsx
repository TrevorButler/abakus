import { useEffect, useState } from 'react'
import { api, type GeographySummary, type GeoType, type StateOption } from '../lib/api'

interface Props {
  geoType: GeoType
  selectedGeoids: string[]
  onToggle: (geoid: string) => void
  maxSelect?: number
}

export default function GeographyList({ geoType, selectedGeoids, onToggle, maxSelect = 1 }: Props) {
  const [states, setStates] = useState<StateOption[]>([])
  const [stateFilter, setStateFilter] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeographySummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listStates().then(setStates).catch(() => setStates([]))
  }, [])

  // Debounced search: re-query on geoType/state/query change, but wait for
  // typing to pause so every keystroke doesn't hit the API.
  useEffect(() => {
    setLoading(true)
    setError(null)
    const handle = setTimeout(() => {
      api
        .searchGeography({ geo_type: geoType, state: stateFilter || undefined, q: query || undefined, limit: 100 })
        .then(setResults)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(handle)
  }, [geoType, stateFilter, query])

  const atSelectionLimit = maxSelect > 1 && selectedGeoids.length >= maxSelect

  return (
    <div className="flex flex-col gap-3 w-full max-w-lg">
      <div className="flex gap-2">
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="border border-abakus-charcoal/20 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s.state_abbr} value={s.state_abbr}>
              {s.state_name}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder={`Search ${geoType === 'place' ? 'places' : 'counties'}...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 border border-abakus-charcoal/20 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-abakus-warm-400 text-sm">{error}</p>}

      <ul className="border border-abakus-charcoal/10 rounded-lg overflow-y-auto max-h-80 bg-white divide-y divide-abakus-charcoal/5">
        {loading && <li className="px-4 py-3 text-sm text-abakus-light-grey">Loading...</li>}
        {!loading && results.length === 0 && (
          <li className="px-4 py-3 text-sm text-abakus-light-grey">No matches.</li>
        )}
        {!loading &&
          results.map((geo) => {
            const isSelected = selectedGeoids.includes(geo.geoid)
            const disabled = !isSelected && atSelectionLimit
            return (
              <li key={geo.geoid}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggle(geo.geoid)}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                    isSelected
                      ? 'bg-abakus-blue/10 text-abakus-charcoal font-medium'
                      : disabled
                        ? 'text-abakus-light-grey/50 cursor-not-allowed'
                        : 'hover:bg-abakus-cream text-abakus-charcoal'
                  }`}
                >
                  {geo.display_name}
                </button>
              </li>
            )
          })}
      </ul>
    </div>
  )
}
