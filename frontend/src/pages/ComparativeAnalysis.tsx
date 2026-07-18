import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type GeoType, type GeographySummary, type ComparativeMatch, type StateOption } from '../lib/api'
import GeographyList from '../components/GeographyList'
import MultiGeoDashboard from './MultiGeoDashboard'

const MAX_COMPARISONS = 5
const SUGGESTION_YEAR = 2024

export default function ComparativeAnalysis() {
  const [geoType, setGeoType] = useState<GeoType>('place')
  const [primaryGeoid, setPrimaryGeoid] = useState<string | null>(null)
  const [primaryGeo, setPrimaryGeo] = useState<GeographySummary | null>(null)
  const [states, setStates] = useState<StateOption[]>([])
  const [suggestionState, setSuggestionState] = useState('')
  const [suggestions, setSuggestions] = useState<ComparativeMatch[]>([])
  const [comparisonGeoids, setComparisonGeoids] = useState<string[]>([])
  const [geoLabels, setGeoLabels] = useState<Record<string, string>>({})
  const [showDashboard, setShowDashboard] = useState(false)

  useEffect(() => {
    api.listStates().then(setStates).catch(() => setStates([]))
  }, [])

  useEffect(() => {
    if (!primaryGeoid) {
      setPrimaryGeo(null)
      return
    }
    api.getGeography(primaryGeoid).then(setPrimaryGeo).catch(() => setPrimaryGeo(null))
  }, [primaryGeoid])

  // A new target resets the comparison set -- kept as its own effect (not
  // combined with the suggestions fetch below) so that changing the state
  // filter only refreshes the suggestions list without wiping out a
  // comparison set the user has already built by hand.
  useEffect(() => {
    setComparisonGeoids([])
  }, [primaryGeoid])

  // Suggestions no longer auto-populate the comparison set -- the box
  // starts empty and the user moves items into it explicitly from the
  // suggestions/search list on the right. suggestionState scopes the
  // candidate pool to one state, or leaves it open to the full 7-state
  // region when empty.
  useEffect(() => {
    if (!primaryGeoid) {
      setSuggestions([])
      return
    }
    api
      .getComparativeCommunities(primaryGeoid, { year: SUGGESTION_YEAR, top_n: 5, state_filter: suggestionState || undefined })
      .then((res) => setSuggestions(res.results))
      .catch(() => setSuggestions([]))
  }, [primaryGeoid, suggestionState])

  // Suggested geographies already carry their own display_name; anything
  // added via the free-search list below doesn't, so its label has to be
  // fetched separately -- otherwise the dashboard header/legend falls back
  // to showing a bare geoid for those.
  useEffect(() => {
    const known = new Set(suggestions.map((s) => s.geoid))
    const missing = comparisonGeoids.filter((g) => !known.has(g) && !(g in geoLabels))
    if (missing.length === 0) return
    Promise.all(
      missing.map((g) => api.getGeography(g).then((geo) => [g, geo.display_name] as const).catch(() => [g, g] as const))
    ).then((pairs) => setGeoLabels((prev) => ({ ...prev, ...Object.fromEntries(pairs) })))
  }, [comparisonGeoids, suggestions, geoLabels])

  function toggleComparison(geoid: string) {
    setComparisonGeoids((prev) =>
      prev.includes(geoid) ? prev.filter((g) => g !== geoid) : prev.length < MAX_COMPARISONS ? [...prev, geoid] : prev
    )
  }

  if (showDashboard && primaryGeo) {
    const geographies = [
      { geoid: primaryGeo.geoid, label: primaryGeo.display_name },
      ...comparisonGeoids
        .filter((g) => g !== primaryGeo.geoid)
        .map((geoid) => {
          const match = suggestions.find((s) => s.geoid === geoid)
          return { geoid, label: match?.display_name ?? geoLabels[geoid] ?? geoid }
        }),
    ]
    return (
      <div className="flex-1 flex flex-col items-center px-6 py-10 gap-4">
        <div className="text-center">
          <h1 className="text-3xl font-medium text-abakus-charcoal mb-1">Comparative Analysis</h1>
          <p className="text-abakus-light-grey text-sm">{geographies.map((g) => g.label).join(' vs. ')}</p>
          <button type="button" onClick={() => setShowDashboard(false)} className="text-abakus-blue hover:underline text-sm mt-1">
            Change geographies
          </button>
        </div>
        <MultiGeoDashboard geographies={geographies} />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-12 gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-2">Comparative Analysis</h1>
        <p className="text-abakus-light-grey">Choose a primary geography, then up to five to compare it against.</p>
      </div>

      <ToggleGroup
        value={geoType}
        onChange={(v) => {
          setGeoType(v as GeoType)
          setPrimaryGeoid(null)
        }}
        options={[
          { value: 'place', label: 'Place' },
          { value: 'county', label: 'County' },
        ]}
      />

      {/* Desktop-first, 3 panels once a primary is picked: target selector
          stays on the left, the comparison set the user is building sits
          in a dedicated box in the center, and suggestions + free search
          move to the right -- clicking an item on the right moves it into
          the center box; clicking a center-box item removes it. The box
          starts empty; suggestions no longer auto-populate it. */}
      <div className={`w-full ${primaryGeo ? 'max-w-6xl grid grid-cols-1 lg:grid-cols-3 gap-8 items-start' : 'flex justify-center'}`}>
        <div>
          <p className="text-sm text-abakus-light-grey mb-2 text-center">Target geography</p>
          <GeographyList
            key={`primary-${geoType}`}
            geoType={geoType}
            selectedGeoids={primaryGeoid ? [primaryGeoid] : []}
            onToggle={setPrimaryGeoid}
          />
        </div>

        {primaryGeo && (
          <>
            <div className="flex flex-col gap-3 items-center">
              <p className="text-sm text-abakus-light-grey text-center">
                Comparison set ({comparisonGeoids.length}/{MAX_COMPARISONS})
              </p>
              <div className="w-full border border-abakus-charcoal/10 rounded-lg bg-white min-h-[220px] p-2 flex flex-col gap-1">
                {comparisonGeoids.length === 0 ? (
                  <p className="text-xs text-abakus-light-grey/70 text-center py-10 px-3">
                    Choose communities from the list on the right to build your comparison set.
                  </p>
                ) : (
                  comparisonGeoids.map((geoid) => {
                    const match = suggestions.find((s) => s.geoid === geoid)
                    const label = match?.display_name ?? geoLabels[geoid] ?? geoid
                    return (
                      <button
                        key={geoid}
                        type="button"
                        onClick={() => toggleComparison(geoid)}
                        title="Remove from comparison set"
                        className="w-full text-left px-3 py-2 rounded-md text-sm bg-abakus-pink/10 hover:bg-abakus-pink/20 transition-colors flex justify-between items-center gap-2"
                      >
                        <span>{label}</span>
                        <span className="text-abakus-light-grey text-xs shrink-0">Remove</span>
                      </button>
                    )
                  })
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowDashboard(true)}
                disabled={comparisonGeoids.length === 0}
                className="bg-abakus-pink text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                Open Dashboard
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <p className="text-sm text-abakus-light-grey text-center mb-2">
                  Suggested most similar to {primaryGeo.display_name}
                </p>
                <div className="flex items-center justify-center gap-2 mb-2 text-sm">
                  <label className="flex items-center gap-2 text-abakus-light-grey">
                    Suggest from
                    <select
                      value={suggestionState}
                      onChange={(e) => setSuggestionState(e.target.value)}
                      className="border border-abakus-charcoal/20 rounded-lg px-2 py-1 bg-white text-abakus-charcoal"
                    >
                      <option value="">All states</option>
                      {states.map((s) => (
                        <option key={s.state_abbr} value={s.state_abbr}>
                          {s.state_name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <ul className="border border-abakus-charcoal/10 rounded-lg bg-white divide-y divide-abakus-charcoal/5">
                  {suggestions.map((s) => (
                    <li key={s.geoid}>
                      <button
                        type="button"
                        onClick={() => toggleComparison(s.geoid)}
                        disabled={!comparisonGeoids.includes(s.geoid) && comparisonGeoids.length >= MAX_COMPARISONS}
                        className={`w-full text-left px-4 py-2 text-sm flex justify-between ${
                          comparisonGeoids.includes(s.geoid) ? 'bg-abakus-pink/10 font-medium' : 'hover:bg-abakus-cream'
                        }`}
                      >
                        <span>{s.display_name}</span>
                        <span className="text-abakus-light-grey">#{s.rank}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-sm text-abakus-light-grey mb-2 text-center">Or search for others</p>
                <GeographyList
                  key={`comparison-${geoType}`}
                  geoType={geoType}
                  selectedGeoids={comparisonGeoids}
                  onToggle={toggleComparison}
                  maxSelect={MAX_COMPARISONS}
                />
              </div>
            </div>
          </>
        )}
      </div>

      <Link to="/acs" className="text-abakus-blue hover:underline text-sm mt-auto">
        Back to mode selection
      </Link>
    </div>
  )
}

function ToggleGroup({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-abakus-charcoal/15 overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-4 py-1.5 text-sm font-medium transition-colors ${
            value === opt.value ? 'bg-abakus-charcoal text-white' : 'bg-white text-abakus-charcoal hover:bg-abakus-cream'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
