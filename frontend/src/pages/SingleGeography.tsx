import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type GeoType, type GeographySummary } from '../lib/api'
import GeographyList from '../components/GeographyList'
import GeographyMap from '../components/GeographyMap'

export default function SingleGeography() {
  const [geoType, setGeoType] = useState<GeoType>('place')
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [selectedGeoid, setSelectedGeoid] = useState<string | null>(null)
  const [selectedGeo, setSelectedGeo] = useState<GeographySummary | null>(null)

  // Single source of truth for "what did the user select," regardless of
  // whether it came from the list or the map -- both just emit a geoid.
  useEffect(() => {
    if (!selectedGeoid) {
      setSelectedGeo(null)
      return
    }
    api.getGeography(selectedGeoid).then(setSelectedGeo).catch(() => setSelectedGeo(null))
  }, [selectedGeoid])

  function handleGeoTypeChange(next: GeoType) {
    setGeoType(next)
    setSelectedGeoid(null)
  }

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-12 gap-8">
      <div className="text-center">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-2">Single Geography Analysis</h1>
        <p className="text-abakus-light-grey">Choose a place or county to explore.</p>
      </div>

      <div className="flex gap-6 items-center">
        <ToggleGroup
          value={geoType}
          onChange={(v) => handleGeoTypeChange(v as GeoType)}
          options={[
            { value: 'place', label: 'Place' },
            { value: 'county', label: 'County' },
          ]}
        />
        <ToggleGroup
          value={viewMode}
          onChange={(v) => setViewMode(v as 'list' | 'map')}
          options={[
            { value: 'list', label: 'List' },
            { value: 'map', label: 'Map' },
          ]}
        />
      </div>

      <div className="w-full max-w-lg flex justify-center">
        {viewMode === 'list' ? (
          <GeographyList
            key={geoType}
            geoType={geoType}
            selectedGeoids={selectedGeoid ? [selectedGeoid] : []}
            onToggle={(geoid) => setSelectedGeoid(geoid)}
          />
        ) : (
          <div className="w-full">
            <GeographyMap
              geoType={geoType}
              selectedGeoids={selectedGeoid ? [selectedGeoid] : []}
              onToggle={(geoid) => setSelectedGeoid(geoid)}
            />
          </div>
        )}
      </div>

      {selectedGeo && (
        <div className="flex flex-col items-center gap-3 border-t border-abakus-charcoal/10 pt-6 w-full max-w-lg">
          <p className="text-abakus-charcoal">
            Selected: <span className="font-medium">{selectedGeo.display_name}</span>
          </p>
          <button
            type="button"
            className="bg-abakus-blue text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity"
          >
            Open Dashboard
          </button>
        </div>
      )}

      <Link to="/" className="text-abakus-blue hover:underline text-sm mt-auto">
        Back to mode selection
      </Link>
    </div>
  )
}

function ToggleGroup({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
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
