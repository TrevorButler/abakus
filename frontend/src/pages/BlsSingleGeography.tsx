import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type GeographySummary } from '../lib/api'
import GeographyList from '../components/GeographyList'
import GeographyMap from '../components/GeographyMap'

// BLS QCEW is published at county granularity only -- no place/county
// toggle here, unlike the ACS SingleGeography picker this mirrors.
export default function BlsSingleGeography() {
  const navigate = useNavigate()
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [selectedGeoid, setSelectedGeoid] = useState<string | null>(null)
  const [selectedGeo, setSelectedGeo] = useState<GeographySummary | null>(null)

  useEffect(() => {
    if (!selectedGeoid) {
      setSelectedGeo(null)
      return
    }
    api.getGeography(selectedGeoid).then(setSelectedGeo).catch(() => setSelectedGeo(null))
  }, [selectedGeoid])

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-12 gap-8">
      <div className="text-center">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-2">BLS Single Geography</h1>
        <p className="text-abakus-light-grey">Choose a county to explore employment and wage trends.</p>
      </div>

      <ToggleGroup
        value={viewMode}
        onChange={(v) => setViewMode(v as 'list' | 'map')}
        options={[
          { value: 'list', label: 'List' },
          { value: 'map', label: 'Map' },
        ]}
      />

      <div className="w-full max-w-lg flex justify-center">
        {viewMode === 'list' ? (
          <GeographyList
            geoType="county"
            selectedGeoids={selectedGeoid ? [selectedGeoid] : []}
            onToggle={(geoid) => setSelectedGeoid(geoid)}
          />
        ) : (
          <div className="w-full">
            <GeographyMap
              geoType="county"
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
            onClick={() => navigate(`/bls/single/${selectedGeo.geoid}`)}
            className="bg-abakus-blue text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity"
          >
            Open Dashboard
          </button>
        </div>
      )}

      <Link to="/bls" className="text-abakus-blue hover:underline text-sm mt-auto">
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
