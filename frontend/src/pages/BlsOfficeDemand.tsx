import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, BLS_SECTORS, type BlsOfficeDemandParams, type BlsOfficeDemandResult, type BlsRateBasis } from '../lib/api'
import GeographyList from '../components/GeographyList'
import GeographyMap from '../components/GeographyMap'
import { formatValue } from '../lib/chartMeta'
import DownloadSheetsButton from '../components/DownloadSheetsButton'
import type { SheetData } from '../lib/download'

const MIN_YEAR = 2014 // QCEW's bulk open-data API only serves a rolling window, not back to 2010
const MAX_YEAR = 2025

interface SectorFormState {
  enabled: boolean
  rate_basis: BlsRateBasis
  custom_rate: number
  custom_start_year: number
  custom_end_year: number
}

function defaultSectorParams(baseYear: number): Record<string, SectorFormState> {
  return Object.fromEntries(
    BLS_SECTORS.map((s) => [
      s.code,
      { enabled: true, rate_basis: '10yr' as BlsRateBasis, custom_rate: 2.0, custom_start_year: baseYear - 3, custom_end_year: baseYear },
    ])
  )
}

// The one office-demand form deliberately gives every sector its own
// independent rate window (not just a single global rate) -- COVID/plant-
// closure/relocation distortions mean a single fixed lookback is often
// wrong, and different sectors behave differently, per the explicit
// flexibility requirement this module was built around.
export default function BlsOfficeDemand() {
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [selectedGeoid, setSelectedGeoid] = useState<string | null>(null)
  const [selectedLabel, setSelectedLabel] = useState<string>('')

  const [baseYear, setBaseYear] = useState(2024)
  const [targetYear, setTargetYear] = useState(2029)
  const [sectorParams, setSectorParams] = useState<Record<string, SectorFormState>>(() => defaultSectorParams(2024))

  const [result, setResult] = useState<BlsOfficeDemandResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function selectGeo(geoid: string) {
    setSelectedGeoid(geoid)
    setResult(null)
    api.getGeography(geoid).then((geo) => setSelectedLabel(geo.display_name)).catch(() => setSelectedLabel(geoid))
  }

  function updateSector(code: string, patch: Partial<SectorFormState>) {
    setSectorParams((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }))
  }

  function runProjection() {
    if (!selectedGeoid) return
    setLoading(true)
    setError(null)
    setResult(null)
    const body: BlsOfficeDemandParams = {
      base_year: baseYear,
      target_year: targetYear,
      sectors: BLS_SECTORS.map((s) => {
        const p = sectorParams[s.code]
        return {
          naics_code: s.code,
          enabled: p.enabled,
          rate_basis: p.rate_basis,
          custom_rate: p.rate_basis === 'custom_rate' ? p.custom_rate / 100 : undefined,
          custom_start_year: p.rate_basis === 'custom_years' ? p.custom_start_year : undefined,
          custom_end_year: p.rate_basis === 'custom_years' ? p.custom_end_year : undefined,
        }
      }),
    }
    api.bls
      .projectOfficeDemand(selectedGeoid, body)
      .then(setResult)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-12 gap-8">
      <div className="text-center">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-2">Office Demand Projections</h1>
        <p className="text-abakus-light-grey">Choose a county, then set your projection assumptions per sector.</p>
      </div>

      <ToggleGroup value={viewMode} onChange={(v) => setViewMode(v as 'list' | 'map')} options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />

      <div className={`w-full ${selectedGeoid ? 'max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-start' : 'max-w-lg flex justify-center'}`}>
        <div className="w-full flex justify-center">
          {viewMode === 'list' ? (
            <GeographyList geoType="county" selectedGeoids={selectedGeoid ? [selectedGeoid] : []} onToggle={selectGeo} />
          ) : (
            <div className="w-full">
              <GeographyMap geoType="county" selectedGeoids={selectedGeoid ? [selectedGeoid] : []} onToggle={selectGeo} />
            </div>
          )}
        </div>

        {selectedGeoid && (
          <div className="flex flex-col gap-6">
            <p className="text-abakus-charcoal text-center">
              Selected: <span className="font-medium">{selectedLabel || '...'}</span>
            </p>

            <div className="flex flex-col gap-4 bg-white rounded-xl border border-abakus-charcoal/10 p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-abakus-charcoal">Base year</label>
                  <YearSelect value={baseYear} onChange={(v) => { setBaseYear(v); setSectorParams(defaultSectorParams(v)) }} />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-abakus-charcoal">Target year</label>
                  <input
                    type="number"
                    min={baseYear + 1}
                    value={targetYear}
                    onChange={(e) => setTargetYear(Number(e.target.value))}
                    className="border border-abakus-charcoal/20 rounded-lg px-3 py-2 bg-white"
                  />
                </div>
              </div>

              <div className="flex flex-col">
                {BLS_SECTORS.map((sector) => (
                  <SectorRateField
                    key={sector.code}
                    label={sector.label}
                    state={sectorParams[sector.code]}
                    onChange={(patch) => updateSector(sector.code, patch)}
                  />
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={runProjection}
              disabled={loading}
              className="bg-abakus-green text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 self-center"
            >
              {loading ? 'Running...' : 'Run Projection'}
            </button>

            {error && <p className="text-abakus-warm-400 text-center">{error}</p>}
          </div>
        )}
      </div>

      {result && (
        <div className="w-full max-w-[1600px]">
          <ResultsPanel result={result} countyLabel={selectedLabel} />
        </div>
      )}

      <Link to="/bls" className="text-abakus-blue hover:underline text-sm mt-auto">
        Back to mode selection
      </Link>
    </div>
  )
}

function ResultsPanel({ result, countyLabel }: { result: BlsOfficeDemandResult; countyLabel: string }) {
  const sectorLabel = (code: string) => BLS_SECTORS.find((s) => s.code === code)?.label ?? code

  const sectorRows: (string | number)[][] = [
    ['Sector', 'Base Employment', 'Annual Rate', 'Projected Employment', 'Sqft Demand (Low)', 'Sqft Demand (High)'],
    ...Object.entries(result.sector_projections).map(([code, proj]) => {
      const sqft = result.sector_sqft_demand[code]
      const low = sqft?.sqft_demand ?? sqft?.sqft_demand_low ?? ''
      const high = sqft?.sqft_demand ?? sqft?.sqft_demand_high ?? ''
      return [
        sectorLabel(code),
        proj.base_employment ?? '',
        proj.rate !== null ? formatValue(proj.rate, 'percent') : 'n/a',
        proj.projected_employment ?? '',
        low,
        high,
      ]
    }),
  ]

  const placeRows: (string | number)[][] = [
    ['Place', 'Professional Sqft Demand', 'Medical Sqft Demand (Low)', 'Medical Sqft Demand (High)'],
    ...Object.keys(result.professional_sqft_by_place).map((geoid) => [
      result.professional_sqft_by_place[geoid]?.display_name ?? geoid,
      result.professional_sqft_by_place[geoid]?.allocated_sqft ?? 0,
      result.medical_sqft_by_place_low[geoid]?.allocated_sqft ?? 0,
      result.medical_sqft_by_place_high[geoid]?.allocated_sqft ?? 0,
    ]),
  ]

  const sheets: SheetData[] = [
    { name: 'Sector Projections', rows: sectorRows },
    { name: 'Place Allocation', rows: placeRows },
  ]

  return (
    <div className="flex flex-col gap-6 items-center">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
        <StatCard label="Countywide Professional Sqft Demand" value={formatValue(result.countywide_professional_sqft_demand, 'count')} />
        <StatCard
          label="Countywide Medical Sqft Demand"
          value={`${formatValue(result.countywide_medical_sqft_demand_low, 'count')} -- ${formatValue(result.countywide_medical_sqft_demand_high, 'count')}`}
        />
        <StatCard label="Places in Allocation" value={String(Object.keys(result.professional_sqft_by_place).length)} />
      </div>

      <div className="w-full overflow-x-auto bg-white rounded-xl border border-abakus-charcoal/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-abakus-charcoal/10 text-left text-abakus-light-grey">
              {sectorRows[0].map((h) => (
                <th key={String(h)} className="px-4 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sectorRows.slice(1).map((row, i) => (
              <tr key={i} className="border-b border-abakus-charcoal/5 last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-2 text-abakus-charcoal">
                    {typeof cell === 'number' ? cell.toLocaleString(undefined, { maximumFractionDigits: 0 }) : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="w-full overflow-x-auto bg-white rounded-xl border border-abakus-charcoal/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-abakus-charcoal/10 text-left text-abakus-light-grey">
              {placeRows[0].map((h) => (
                <th key={String(h)} className="px-4 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {placeRows.slice(1).map((row, i) => (
              <tr key={i} className="border-b border-abakus-charcoal/5 last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-2 text-abakus-charcoal">
                    {typeof cell === 'number' ? cell.toLocaleString(undefined, { maximumFractionDigits: 0 }) : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DownloadSheetsButton filename={`${countyLabel || 'Office Demand'}.xlsx`} sheets={sheets} />
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-abakus-charcoal/10 p-4 flex flex-col gap-1">
      <p className="text-xs text-abakus-light-grey">{label}</p>
      <p className="text-xl font-medium text-abakus-charcoal">{value}</p>
    </div>
  )
}

function SectorRateField({
  label,
  state,
  onChange,
}: {
  label: string
  state: SectorFormState
  onChange: (patch: Partial<SectorFormState>) => void
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-2 py-2 border-b border-abakus-charcoal/10 last:border-0">
      <label className="flex items-center gap-2 md:w-56 shrink-0">
        <input type="checkbox" checked={state.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
        <span className="text-sm text-abakus-charcoal">{label}</span>
      </label>
      {state.enabled && (
        <div className="flex items-center gap-2 flex-wrap">
          <ToggleGroup
            value={state.rate_basis}
            onChange={(v) => onChange({ rate_basis: v as BlsRateBasis })}
            options={[
              { value: '5yr', label: '5yr' },
              { value: '10yr', label: '10yr' },
              { value: 'custom_rate', label: 'Custom Rate' },
              { value: 'custom_years', label: 'Custom Years' },
            ]}
          />
          {state.rate_basis === 'custom_rate' && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                value={state.custom_rate}
                onChange={(e) => onChange({ custom_rate: Number(e.target.value) })}
                className="border border-abakus-charcoal/20 rounded-lg px-3 py-2 bg-white w-24"
              />
              <span className="text-sm text-abakus-light-grey">% per year</span>
            </div>
          )}
          {state.rate_basis === 'custom_years' && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={state.custom_start_year}
                onChange={(e) => onChange({ custom_start_year: Number(e.target.value) })}
                className="border border-abakus-charcoal/20 rounded-lg px-3 py-2 bg-white w-20"
              />
              <span className="text-sm text-abakus-light-grey">to</span>
              <input
                type="number"
                value={state.custom_end_year}
                onChange={(e) => onChange({ custom_end_year: Number(e.target.value) })}
                className="border border-abakus-charcoal/20 rounded-lg px-3 py-2 bg-white w-20"
              />
            </div>
          )}
        </div>
      )}
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
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            value === opt.value ? 'bg-abakus-charcoal text-white' : 'bg-white text-abakus-charcoal hover:bg-abakus-cream'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function YearSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const years = []
  for (let y = MIN_YEAR; y <= MAX_YEAR; y++) years.push(y)
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="border border-abakus-charcoal/20 rounded-lg px-2 py-1 bg-white">
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  )
}
