import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type PumaSummary } from '../lib/api'
import PumaMap from '../components/PumaMap'
import ErrorBarChartCard from '../components/charts/ErrorBarChartCard'
import { downloadCSV } from '../lib/download'

export default function PumaHouseholdSummary() {
  const [selectedGeoid, setSelectedGeoid] = useState<string | null>(null)
  const [selectedLabel, setSelectedLabel] = useState<string>('')
  const [showCounties, setShowCounties] = useState(false)
  const [showPlaces, setShowPlaces] = useState(false)

  const [summary, setSummary] = useState<PumaSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function selectGeo(geoid: string) {
    setSelectedGeoid(geoid)
    setSummary(null)
    api.getGeography(geoid).then((geo) => setSelectedLabel(geo.display_name)).catch(() => setSelectedLabel(geoid))
  }

  useEffect(() => {
    if (!selectedGeoid) return
    setLoading(true)
    setError(null)
    api.pums
      .getHouseholdSummary(selectedGeoid)
      .then(setSummary)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [selectedGeoid])

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-12 gap-8">
      <div className="text-center">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-2">PUMA Household Averages</h1>
        <p className="text-abakus-light-grey">Click a PUMA on the map to see its household size and school-aged children averages.</p>
      </div>

      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showCounties} onChange={(e) => setShowCounties(e.target.checked)} />
          Show counties
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showPlaces} onChange={(e) => setShowPlaces(e.target.checked)} />
          Show places
        </label>
      </div>

      <div className="w-full max-w-3xl">
        <PumaMap selectedGeoid={selectedGeoid} onToggle={selectGeo} showCounties={showCounties} showPlaces={showPlaces} />
      </div>

      {selectedGeoid && (
        <p className="text-abakus-charcoal text-center">
          Selected: <span className="font-medium">{selectedLabel || '...'}</span>
        </p>
      )}

      {error && <p className="text-abakus-warm-400">{error}</p>}
      {loading && <p className="text-abakus-light-grey">Loading...</p>}

      {summary && (
        <div className="w-full max-w-[1200px] flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ErrorBarChartCard title="Average Household Size by Unit Type" data={summary.household_size_by_unit_type} valueLabel="Persons" />
            <ErrorBarChartCard title="Average School-Aged Children by Unit Type" data={summary.school_children_by_unit_type} valueLabel="Children" />
          </div>

          <BedroomDistributionCard distribution={summary.bedroom_distribution} />
        </div>
      )}

      <Link to="/pums" className="text-abakus-blue hover:underline text-sm mt-auto">
        Back to mode selection
      </Link>
    </div>
  )
}

function BedroomDistributionCard({ distribution }: { distribution: Record<string, number> }) {
  const entries = Object.entries(distribution)
  if (entries.length === 0) return null

  const rows: (string | number)[][] = [['Bedroom Count', 'Share'], ...entries.map(([label, share]) => [label, share])]

  return (
    <div className="bg-white rounded-xl border border-abakus-charcoal/10 p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-abakus-charcoal">Bedroom Distribution (All Unit Types)</h2>
        <button
          type="button"
          onClick={() => downloadCSV('Bedroom Distribution.csv', rows)}
          className="text-abakus-blue hover:underline text-sm"
        >
          Download chart data
        </button>
      </div>
      <div className="flex flex-wrap gap-4">
        {entries.map(([label, share]) => (
          <div key={label} className="flex flex-col gap-1 min-w-[100px]">
            <p className="text-xs text-abakus-light-grey">{label}</p>
            <p className="text-lg font-medium text-abakus-charcoal">{(share * 100).toFixed(1)}%</p>
          </div>
        ))}
      </div>
    </div>
  )
}
