import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  api,
  type DemandBasis,
  type GeoType,
  type HousingDemandResult,
  type RateBasis,
  type TurnoverTier,
  type TurnoverTierOption,
} from '../lib/api'
import GeographyList from '../components/GeographyList'
import GeographyMap from '../components/GeographyMap'
import LineChartCard from '../components/charts/LineChartCard'
import DemandBreakdownChart from '../components/charts/DemandBreakdownChart'
import { formatValue } from '../lib/chartMeta'
import { downloadWorkbook, seriesRows, ageIncomeRows, type SheetData } from '../lib/download'

const MIN_YEAR = 2010
const MAX_YEAR = 2024

// Years < base_year come from population_actual/household_size_actual
// (reported ACS data); base_year onward comes from the *_projected series
// (which is seeded from the same base_year value, so the join is seamless).
function mergeActualProjected(actual: Record<string, number>, projected: Record<string, number>, baseYear: number) {
  const merged: Record<string, number> = {}
  for (const [year, value] of Object.entries(actual)) {
    if (Number(year) < baseYear) merged[year] = value
  }
  for (const [year, value] of Object.entries(projected)) {
    merged[year] = value
  }
  return merged
}

const MAX_REGION_SIZE = 50

export default function HousingDemand() {
  const [geoType, setGeoType] = useState<GeoType>('place')
  const [scope, setScope] = useState<'single' | 'region'>('single')
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [selectedGeoids, setSelectedGeoids] = useState<string[]>([])
  const [geoLabels, setGeoLabels] = useState<Record<string, string>>({})

  const [baseYear, setBaseYear] = useState(2024)
  const [targetYear, setTargetYear] = useState(2029)
  const [popRateBasis, setPopRateBasis] = useState<RateBasis>('10yr')
  const [popCustomRate, setPopCustomRate] = useState(1.0)
  const [hhSizeRateBasis, setHhSizeRateBasis] = useState<RateBasis>('10yr')
  const [hhSizeCustomRate, setHhSizeCustomRate] = useState(-0.5)
  const [turnoverTiers, setTurnoverTiers] = useState<TurnoverTierOption[]>([])
  const [turnoverTier, setTurnoverTier] = useState<TurnoverTier>('standard')
  const [turnoverCustomRate, setTurnoverCustomRate] = useState(0.25)
  const [b19037RateBasis, setB19037RateBasis] = useState<RateBasis>('10yr')
  const [b19037CustomRate, setB19037CustomRate] = useState(1.0)
  const [b19037DemandBasis, setB19037DemandBasis] = useState<DemandBasis>('annual')

  const [result, setResult] = useState<HousingDemandResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getTurnoverTiers().then(setTurnoverTiers).catch(() => setTurnoverTiers([]))
  }, [])

  // Single source of truth for display names, whether the geoid came from
  // the list or the map -- both just emit geoids.
  useEffect(() => {
    const missing = selectedGeoids.filter((g) => !(g in geoLabels))
    if (missing.length === 0) return
    Promise.all(
      missing.map((g) => api.getGeography(g).then((geo) => [g, geo.display_name] as const).catch(() => [g, g] as const))
    ).then((pairs) => setGeoLabels((prev) => ({ ...prev, ...Object.fromEntries(pairs) })))
  }, [selectedGeoids, geoLabels])

  function handleGeoTypeChange(next: GeoType) {
    setGeoType(next)
    setSelectedGeoids([])
    setResult(null)
  }

  function handleScopeChange(next: 'single' | 'region') {
    setScope(next)
    setSelectedGeoids([])
    setResult(null)
  }

  function toggleGeo(geoid: string) {
    setResult(null)
    if (scope === 'single') {
      setSelectedGeoids([geoid])
      return
    }
    setSelectedGeoids((prev) => (prev.includes(geoid) ? prev.filter((g) => g !== geoid) : prev.length < MAX_REGION_SIZE ? [...prev, geoid] : prev))
  }

  function runProjection() {
    if (selectedGeoids.length === 0) return
    setLoading(true)
    setError(null)
    setResult(null)
    const params = {
      base_year: baseYear,
      target_year: targetYear,
      pop_rate_basis: popRateBasis,
      pop_custom_rate: popRateBasis === 'custom' ? popCustomRate / 100 : undefined,
      hh_size_rate_basis: hhSizeRateBasis,
      hh_size_custom_rate: hhSizeRateBasis === 'custom' ? hhSizeCustomRate / 100 : undefined,
      turnover_tier: turnoverTier,
      turnover_custom_rate: turnoverTier === 'custom' ? turnoverCustomRate / 100 : undefined,
      b19037_rate_basis: b19037RateBasis,
      b19037_custom_rate: b19037RateBasis === 'custom' ? b19037CustomRate / 100 : undefined,
      b19037_demand_basis: b19037DemandBasis,
    }
    const request = scope === 'single' ? api.getHousingDemand(selectedGeoids[0], params) : api.getHousingDemandRegion(selectedGeoids, params)
    request.then(setResult).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-12 gap-8">
      <div className="text-center">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-2">Housing Demand Projections</h1>
        <p className="text-abakus-light-grey">
          {scope === 'single' ? 'Choose a place or county, then set your projection assumptions.' : 'Select a region, then set your projection assumptions.'}
        </p>
      </div>

      <div className="flex gap-6 items-center flex-wrap justify-center">
        <ToggleGroup
          value={scope}
          onChange={(v) => handleScopeChange(v as 'single' | 'region')}
          options={[
            { value: 'single', label: 'Single Geography' },
            { value: 'region', label: 'Region' },
          ]}
        />
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
            key={`${geoType}-${scope}`}
            geoType={geoType}
            selectedGeoids={selectedGeoids}
            onToggle={toggleGeo}
            maxSelect={scope === 'region' ? MAX_REGION_SIZE : 1}
          />
        ) : (
          <div className="w-full">
            <GeographyMap geoType={geoType} selectedGeoids={selectedGeoids} onToggle={toggleGeo} />
          </div>
        )}
      </div>

      {selectedGeoids.length > 0 && (
        <div className="w-full max-w-3xl flex flex-col gap-6 border-t border-abakus-charcoal/10 pt-8">
          <p className="text-abakus-charcoal text-center">
            {scope === 'single' ? (
              <>
                Selected: <span className="font-medium">{geoLabels[selectedGeoids[0]] ?? '...'}</span>
              </>
            ) : (
              <>
                {selectedGeoids.length} geograph{selectedGeoids.length === 1 ? 'y' : 'ies'} selected:{' '}
                <span className="font-medium">{selectedGeoids.map((g) => geoLabels[g] ?? '...').join(', ')}</span>
              </>
            )}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white rounded-xl border border-abakus-charcoal/10 p-6">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-abakus-charcoal">Base year</label>
              <YearSelect value={baseYear} onChange={setBaseYear} />
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

            <RateField label="Population growth rate" basis={popRateBasis} onBasis={setPopRateBasis} customValue={popCustomRate} onCustomValue={setPopCustomRate} />
            <RateField
              label="Household size growth rate"
              basis={hhSizeRateBasis}
              onBasis={setHhSizeRateBasis}
              customValue={hhSizeCustomRate}
              onCustomValue={setHhSizeCustomRate}
            />

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-abakus-charcoal">Internal turnover tier</label>
              <select
                value={turnoverTier}
                onChange={(e) => setTurnoverTier(e.target.value as TurnoverTier)}
                className="border border-abakus-charcoal/20 rounded-lg px-3 py-2 bg-white"
              >
                {turnoverTiers.map((tier) => {
                  const key = tier.key.replace(/^turnover_/, '')
                  return (
                    <option key={tier.key} value={key}>
                      {tier.label} ({formatValue(Number(tier.value), 'percent')})
                    </option>
                  )
                })}
                <option value="custom">Custom</option>
              </select>
              {turnoverTier === 'custom' && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    value={turnoverCustomRate}
                    onChange={(e) => setTurnoverCustomRate(Number(e.target.value))}
                    className="border border-abakus-charcoal/20 rounded-lg px-3 py-2 bg-white w-28"
                  />
                  <span className="text-sm text-abakus-light-grey">% per year</span>
                </div>
              )}
            </div>

            <RateField
              label="Age x income (B19037) trend rate"
              basis={b19037RateBasis}
              onBasis={setB19037RateBasis}
              customValue={b19037CustomRate}
              onCustomValue={setB19037CustomRate}
            />

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-abakus-charcoal">Age x income demand basis</label>
              <ToggleGroup
                value={b19037DemandBasis}
                onChange={(v) => setB19037DemandBasis(v as DemandBasis)}
                options={[
                  { value: 'annual', label: 'Annual demand' },
                  { value: 'total', label: 'Total demand' },
                ]}
              />
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

          {result && <ResultsPanel result={result} />}
        </div>
      )}

      <Link to="/" className="text-abakus-blue hover:underline text-sm mt-auto">
        Back to mode selection
      </Link>
    </div>
  )
}

function ResultsPanel({ result }: { result: HousingDemandResult }) {
  const population = mergeActualProjected(result.population_actual, result.population_projected, result.base_year)
  const householdSize = mergeActualProjected(result.household_size_actual, result.household_size_projected, result.base_year)

  function handleDownload() {
    const summary: (string | number)[][] = [
      ['Metric', 'Value'],
      ['Base Year', result.base_year],
      ['Target Year', result.target_year],
      ['Population Growth Rate', result.population_rate],
      ['Household Size Growth Rate', result.household_size_rate],
      ['Turnover Rate', result.turnover_rate],
      ['Net Household Change', result.net_household_change],
      ['Total Demand', result.total_demand],
      ['Annual Demand', result.annual_demand],
    ]
    const sheets: SheetData[] = [
      { name: 'Summary', rows: summary },
      { name: 'Population', rows: seriesRows('Population', population) },
      { name: 'Household Size', rows: seriesRows('Household Size', householdSize) },
      { name: 'Households', rows: seriesRows('Households', result.households) },
      { name: 'Turnover Demand', rows: seriesRows('Turnover Demand', result.turnover_demand_by_year) },
    ]
    if (result.age_income_breakdown && result.age_income_breakdown.length > 0) {
      sheets.push({ name: 'Demand by Age x Income', rows: ageIncomeRows(result.age_income_breakdown) })
    }
    downloadWorkbook('Housing Demand Projection.xlsx', sheets)
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Net Household Change" value={formatValue(result.net_household_change, 'count')} />
        <StatCard label="Total Demand" value={formatValue(result.total_demand, 'count')} />
        <StatCard label="Annual Demand" value={formatValue(result.annual_demand, 'count')} />
        <StatCard label="Population Growth Rate" value={formatValue(result.population_rate, 'percent')} />
        <StatCard label="Household Size Growth Rate" value={formatValue(result.household_size_rate, 'percent')} />
        <StatCard label="Turnover Rate" value={formatValue(result.turnover_rate, 'percent')} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LineChartCard title="Population (actual + projected)" format="count" series={population} />
        <LineChartCard title="Average Household Size (actual + projected)" format="years" series={householdSize} />
        <LineChartCard title="Households (actual + projected)" format="count" series={result.households} />
        <LineChartCard title="Internal Turnover Demand by Year" format="count" series={result.turnover_demand_by_year} />
      </div>

      {result.age_income_breakdown && result.age_income_breakdown.length > 0 && (
        <DemandBreakdownChart
          title={`Demand by Age x Income (${result.target_year}, ${result.age_income_breakdown ? 'projected' : ''})`}
          cells={result.age_income_breakdown}
        />
      )}

      <button
        type="button"
        onClick={handleDownload}
        className="bg-abakus-charcoal text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity self-center"
      >
        Download Data
      </button>
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

function RateField({
  label,
  basis,
  onBasis,
  customValue,
  onCustomValue,
}: {
  label: string
  basis: RateBasis
  onBasis: (v: RateBasis) => void
  customValue: number
  onCustomValue: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-abakus-charcoal">{label}</label>
      <ToggleGroup
        value={basis}
        onChange={(v) => onBasis(v as RateBasis)}
        options={[
          { value: '5yr', label: '5yr' },
          { value: '10yr', label: '10yr' },
          { value: 'custom', label: 'Custom' },
        ]}
      />
      {basis === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            value={customValue}
            onChange={(e) => onCustomValue(Number(e.target.value))}
            className="border border-abakus-charcoal/20 rounded-lg px-3 py-2 bg-white w-28"
          />
          <span className="text-sm text-abakus-light-grey">% per year</span>
        </div>
      )}
    </div>
  )
}

function YearSelect({ value, onChange, min = MIN_YEAR, max = MAX_YEAR }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const years = []
  for (let y = MIN_YEAR; y <= MAX_YEAR; y++) years.push(y)
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="border border-abakus-charcoal/20 rounded-lg px-3 py-2 bg-white">
      {years.map((y) => (
        <option key={y} value={y} disabled={y < min || y > max}>
          {y}
        </option>
      ))}
    </select>
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
