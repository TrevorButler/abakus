import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, NAICS_SECTORS, type CostarPropertyClass, type GeoType, type SmartReSubdivision } from '../lib/api'
import { CHART_META } from '../lib/chartMeta'
import { blsChartMeta } from '../lib/blsChartMeta'
import GeographyList from '../components/GeographyList'
import GeographyMap from '../components/GeographyMap'
import ChartTopicPicker from '../components/ChartTopicPicker'
import FileUploadSlot from '../components/FileUploadSlot'
import CostarMarketUploader, { newMarket, type MarketState } from '../components/CostarMarketUploader'
import MultiFileUploader, { type UploadItem } from '../components/MultiFileUploader'
import { downloadFromResponse } from '../lib/download'

const MIN_YEAR = 2010
const MAX_YEAR = 2024
const MAX_REGION_SIZE = 50
const MAX_COMPARISON_SIZE = 5

// Mirrors master_export.py's ACS_SECTION_CHARTS exactly -- same
// duplication-across-the-language-boundary convention already used
// throughout this app (chartMeta.ts vs demographics_dashboard.py,
// blsChartMeta.ts vs bls_dashboard.py both keep independent, hand-synced
// copies of the same chart-key set rather than sharing a schema).
const ACS_SECTIONS = [
  {
    name: 'Demographic Analysis',
    keys: [
      'population', 'households', 'age_by_cohort', 'age_by_cohort_simplified',
      'median_age', 'race', 'hispanic_ethnicity', 'household_size', 'household_type',
    ],
  },
  {
    name: 'Economic Analysis',
    keys: ['household_income', 'household_income_simplified', 'median_household_income'],
  },
  {
    name: 'Housing Analysis',
    keys: [
      'housing_units', 'housing_unit_occupancy', 'housing_unit_type', 'housing_unit_type_simplified',
      'year_built', 'year_moved_in', 'tenure', 'median_home_value', 'median_rent',
      'owner_cost_burden', 'renter_cost_burden', 'tenure_by_age_owner', 'tenure_by_age_renter',
      'tenure_by_income_owner', 'tenure_by_income_renter',
    ],
  },
]

const BLS_FIXED_KEYS = ['employment_by_sector', 'avg_pay_by_sector', 'total_employment_trend', 'total_avg_pay_trend']
const BLS_PER_SECTOR_KEYS = NAICS_SECTORS.flatMap((s) =>
  ['employment', 'wage', 'avg_pay'].map((metric) => `${metric}_trend_${s.code}`)
)
const BLS_SECTIONS = [{ name: 'Economic Analysis -- BLS', keys: [...BLS_FIXED_KEYS, ...BLS_PER_SECTOR_KEYS] }]

type Step = 'modules' | 'geography' | 'years' | 'charts' | 'comparison' | 'costar' | 'generate'

export default function MasterModule() {
  const [step, setStep] = useState<Step>('modules')
  // Module selection (step 1) -- decides which later steps/UI blocks even
  // appear, so a user who only wants a plain ACS/BLS deck never sees the
  // Comparison or CoStar/SmartRE steps at all, rather than seeing them and
  // having to notice they're optional. Comparative Analysis has its own
  // toggle; CoStar/SmartRE each have their own since a user might want
  // only one of the three upload types.
  const [enableComparison, setEnableComparison] = useState(false)
  const [enableHeartbeat, setEnableHeartbeat] = useState(false)
  const [enableMarketOverview, setEnableMarketOverview] = useState(false)
  const [enableSmartre, setEnableSmartre] = useState(false)
  const [geoType, setGeoType] = useState<GeoType>('place')
  const [mode, setMode] = useState<'single' | 'regional'>('single')
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [selectedGeoids, setSelectedGeoids] = useState<string[]>([])
  const [geoLabels, setGeoLabels] = useState<Record<string, string>>({})
  const [startYear, setStartYear] = useState(MIN_YEAR)
  const [endYear, setEndYear] = useState(MAX_YEAR)
  const [acsCharts, setAcsCharts] = useState<string[]>([])
  const [blsCharts, setBlsCharts] = useState<string[]>([])
  const [comparisonGeoids, setComparisonGeoids] = useState<string[]>([])
  const [comparisonGeoLabels, setComparisonGeoLabels] = useState<Record<string, string>>({})
  const [comparisonAcsCharts, setComparisonAcsCharts] = useState<string[]>([])
  const [comparisonBlsCharts, setComparisonBlsCharts] = useState<string[]>([])
  const [heartbeatFile, setHeartbeatFile] = useState<File | null>(null)
  const [marketOverviewMarkets, setMarketOverviewMarkets] = useState<MarketState[]>([newMarket()])
  const [smartreItems, setSmartreItems] = useState<UploadItem[]>([{ id: crypto.randomUUID(), name: '', file: null }])
  const [smartreSubdivisions, setSmartreSubdivisions] = useState<SmartReSubdivision[] | null>(null)
  const [smartreSelected, setSmartreSelected] = useState<string[]>([])
  const [smartreLoadingSubs, setSmartreLoadingSubs] = useState(false)
  // Per-comparison-geo CoStar repeater state, keyed by geoid -- lazily
  // populated (a geoid with no entry yet just renders empty inputs).
  const [comparisonHeartbeatFiles, setComparisonHeartbeatFiles] = useState<Record<string, File | null>>({})
  const [comparisonMarkets, setComparisonMarkets] = useState<Record<string, MarketState[]>>({})
  const [reportTitle, setReportTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Same pattern as RegionalAnalysis.tsx: track display names for
  // whatever's currently selected, regardless of whether it came from the
  // list or the map.
  useEffect(() => {
    const missing = selectedGeoids.filter((g) => !(g in geoLabels))
    if (missing.length === 0) return
    Promise.all(missing.map((g) => api.getGeography(g).then((geo) => [g, geo.display_name] as const).catch(() => [g, g] as const))).then(
      (pairs) => setGeoLabels((prev) => ({ ...prev, ...Object.fromEntries(pairs) }))
    )
  }, [selectedGeoids, geoLabels])

  useEffect(() => {
    const missing = comparisonGeoids.filter((g) => !(g in comparisonGeoLabels))
    if (missing.length === 0) return
    Promise.all(missing.map((g) => api.getGeography(g).then((geo) => [g, geo.display_name] as const).catch(() => [g, g] as const))).then(
      (pairs) => setComparisonGeoLabels((prev) => ({ ...prev, ...Object.fromEntries(pairs) }))
    )
  }, [comparisonGeoids, comparisonGeoLabels])

  function handleGeoTypeChange(next: GeoType) {
    setGeoType(next)
    setSelectedGeoids([])
  }

  function handleModeChange(next: 'single' | 'regional') {
    setMode(next)
    setSelectedGeoids([])
  }

  function toggleGeo(geoid: string) {
    if (mode === 'single') {
      setSelectedGeoids([geoid])
      return
    }
    setSelectedGeoids((prev) => (prev.includes(geoid) ? prev.filter((g) => g !== geoid) : prev.length < MAX_REGION_SIZE ? [...prev, geoid] : prev))
  }

  // Comparison entries are always flat single geographies (never
  // themselves regional, even when the subject is Regional) -- mirrors
  // the normal Comparative Analysis flow's own max-5 multi-select.
  function toggleComparisonGeo(geoid: string) {
    setComparisonGeoids((prev) =>
      prev.includes(geoid) ? prev.filter((g) => g !== geoid) : prev.length < MAX_COMPARISON_SIZE ? [...prev, geoid] : prev
    )
  }

  const smartreFiles = smartreItems.map((it) => it.file).filter((f): f is File => f !== null)

  function loadSmartreSubdivisions() {
    if (smartreFiles.length === 0) return
    setSmartreLoadingSubs(true)
    setError(null)
    api.smartre
      .listSubdivisions(smartreFiles)
      .then((res) => {
        setSmartreSubdivisions(res.subdivisions)
        setSmartreSelected([])
      })
      .catch((e) => setError(e.message))
      .finally(() => setSmartreLoadingSubs(false))
  }

  function toggleSmartreSubdivision(name: string) {
    setSmartreSelected((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]))
  }

  // Comparison-geo CoStar repeater state is keyed by geoid and populated
  // lazily -- a geoid without an entry yet just falls back to a fresh
  // single-market default (name pre-filled from step 4's picks).
  function comparisonMarketsFor(geoid: string): MarketState[] {
    return comparisonMarkets[geoid] ?? [newMarket(comparisonGeoLabels[geoid] ?? '')]
  }

  function setComparisonMarketsFor(geoid: string, markets: MarketState[]) {
    setComparisonMarkets((prev) => ({ ...prev, [geoid]: markets }))
  }

  const showCostar = enableHeartbeat || enableMarketOverview || enableSmartre
  // Recomputed every render from the module toggles, so a step disappears
  // from the progress indicator (and from goNext/goBack's chain) the
  // moment its module is unchecked -- no separate "is this step visible"
  // check needed anywhere else in the component.
  const STEPS: { key: Step; label: string }[] = [
    { key: 'modules', label: 'Modules' },
    { key: 'geography', label: 'Geography' },
    { key: 'years', label: 'Years' },
    { key: 'charts', label: 'Data' },
    ...(enableComparison ? [{ key: 'comparison' as Step, label: 'Comparison' }] : []),
    ...(showCostar ? [{ key: 'costar' as Step, label: 'CoStar' }] : []),
    { key: 'generate', label: 'Generate' },
  ]
  const stepIndex = STEPS.findIndex((s) => s.key === step)
  const nextStep = STEPS[stepIndex + 1]

  function goNext() {
    if (nextStep) setStep(nextStep.key)
  }

  function goBack() {
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1].key)
  }

  const totalSelected = acsCharts.length + blsCharts.length
  const regionLabel =
    selectedGeoids.length === 0
      ? ''
      : mode === 'single'
        ? (geoLabels[selectedGeoids[0]] ?? selectedGeoids[0])
        : selectedGeoids.length <= 3
          ? selectedGeoids.map((g) => geoLabels[g] ?? g).join(', ')
          : `${selectedGeoids.length} geographies`

  const readyMarkets = marketOverviewMarkets.filter((m) => m.name.trim() && Object.values(m.files).some((f) => f))

  function generate() {
    if (selectedGeoids.length === 0) return
    setLoading(true)
    setError(null)
    api.master
      .generateDeck({
        placeType: geoType,
        mode,
        geoids: selectedGeoids,
        startYear,
        endYear,
        acsCharts,
        blsCharts,
        comparisonGeoids: enableComparison ? comparisonGeoids : [],
        comparisonAcsCharts: enableComparison ? comparisonAcsCharts : [],
        comparisonBlsCharts: enableComparison ? comparisonBlsCharts : [],
        heartbeatFile: enableHeartbeat ? heartbeatFile : null,
        marketOverviewMarkets: enableMarketOverview
          ? readyMarkets.map((m) => ({
              name: m.name.trim(),
              files: Object.fromEntries(Object.entries(m.files).filter(([, f]) => f)) as Partial<Record<CostarPropertyClass, File>>,
            }))
          : [],
        smartreFiles: enableSmartre && smartreSelected.length > 0 ? smartreFiles : [],
        smartreSubdivisions: enableSmartre ? smartreSelected : [],
        comparisonCostar: enableComparison
          ? comparisonGeoids.map((g) => {
              const markets = comparisonMarketsFor(g).filter((m) => m.name.trim() && Object.values(m.files).some((f) => f))
              return {
                geoid: g,
                heartbeatFile: comparisonHeartbeatFiles[g] ?? null,
                marketOverviewMarkets: markets.map((m) => ({
                  name: m.name.trim(),
                  files: Object.fromEntries(Object.entries(m.files).filter(([, f]) => f)) as Partial<Record<CostarPropertyClass, File>>,
                })),
              }
            })
          : [],
        reportTitle: reportTitle.trim() || undefined,
      })
      .then((blob) => downloadFromResponse(blob, `${reportTitle.trim() || regionLabel}.pptx`))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  return (
    <div className="flex-1 flex flex-col items-center px-6 py-12 gap-8">
      <div className="text-center">
        <h1 className="text-3xl font-medium text-abakus-charcoal mb-2">Report Builder</h1>
        <p className="text-abakus-light-grey">Build one PowerPoint deck with live charts across ACS and BLS data.</p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        {STEPS.map((s, i) => (
          <div key={s.key} className={`px-3 py-1 rounded-full ${i === stepIndex ? 'bg-abakus-charcoal text-white' : 'text-abakus-light-grey'}`}>
            {i + 1}. {s.label}
          </div>
        ))}
      </div>

      {step === 'modules' && (
        <div className="flex flex-col items-center gap-6 w-full max-w-lg">
          <p className="text-abakus-light-grey text-sm text-center max-w-md">
            Choose which optional sections apply to this report. Anything left unchecked won't show up later in
            the wizard, so you only see the steps you actually need.
          </p>
          <div className="flex flex-col gap-3 w-full bg-white rounded-xl border border-abakus-charcoal/10 p-5">
            <label className="flex items-center gap-2 text-sm text-abakus-charcoal">
              <input type="checkbox" checked={enableComparison} onChange={(e) => setEnableComparison(e.target.checked)} />
              Comparative Analysis -- compare against up to {MAX_COMPARISON_SIZE} other geographies
            </label>
            <label className="flex items-center gap-2 text-sm text-abakus-charcoal">
              <input type="checkbox" checked={enableHeartbeat} onChange={(e) => setEnableHeartbeat(e.target.checked)} />
              CoStar Heartbeat -- property export, delivered SF by decade
            </label>
            <label className="flex items-center gap-2 text-sm text-abakus-charcoal">
              <input type="checkbox" checked={enableMarketOverview} onChange={(e) => setEnableMarketOverview(e.target.checked)} />
              CoStar Market Overview -- market data grids
            </label>
            <label className="flex items-center gap-2 text-sm text-abakus-charcoal">
              <input type="checkbox" checked={enableSmartre} onChange={(e) => setEnableSmartre(e.target.checked)} />
              SmartRE Sales -- residential sales comps
            </label>
          </div>
          <button type="button" onClick={goNext} className="bg-abakus-blue text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity">
            Next: Geography
          </button>
        </div>
      )}

      {step === 'geography' && (
        <>
          <div className="flex gap-6 items-center flex-wrap justify-center">
            <ToggleGroup
              value={mode}
              onChange={(v) => handleModeChange(v as 'single' | 'regional')}
              options={[
                { value: 'single', label: 'Single Geography' },
                { value: 'regional', label: 'Regional Analysis' },
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

          {mode === 'regional' && (
            <p className="text-xs text-abakus-light-grey text-center max-w-sm">
              Select up to {MAX_REGION_SIZE} geographies -- they'll be summed into one aggregated regional report (no
              per-geography breakout, matching the rest of this deck's "one coherent report" format).
            </p>
          )}

          <div className="w-full max-w-lg flex justify-center">
            {viewMode === 'list' ? (
              <GeographyList
                key={geoType}
                geoType={geoType}
                selectedGeoids={selectedGeoids}
                onToggle={toggleGeo}
                maxSelect={mode === 'regional' ? MAX_REGION_SIZE : undefined}
              />
            ) : (
              <div className="w-full">
                <GeographyMap geoType={geoType} selectedGeoids={selectedGeoids} onToggle={toggleGeo} />
              </div>
            )}
          </div>

          {selectedGeoids.length > 0 && (
            <div className="flex flex-col items-center gap-3 border-t border-abakus-charcoal/10 pt-6 w-full max-w-lg">
              <p className="text-abakus-charcoal text-center">
                {mode === 'single' ? (
                  <>
                    Selected: <span className="font-medium">{regionLabel}</span>
                  </>
                ) : (
                  <>
                    {selectedGeoids.length} geograph{selectedGeoids.length === 1 ? 'y' : 'ies'} selected:{' '}
                    <span className="font-medium">{regionLabel}</span>
                  </>
                )}
              </p>
              <button type="button" onClick={goNext} className="bg-abakus-blue text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity">
                Next: Years
              </button>
            </div>
          )}
        </>
      )}

      {step === 'years' && selectedGeoids.length > 0 && (
        <div className="flex flex-col items-center gap-6">
          <p className="text-abakus-charcoal text-sm">{regionLabel}</p>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              From
              <YearSelect value={startYear} onChange={setStartYear} max={endYear} />
            </label>
            <label className="flex items-center gap-2">
              To
              <YearSelect value={endYear} onChange={setEndYear} min={startYear} />
            </label>
          </div>
          <p className="text-xs text-abakus-light-grey max-w-sm text-center">
            BLS employment/wage data only goes back to 2014 -- a start year before that is automatically floored to
            2014 for BLS charts only, ACS charts still use your full range.
          </p>
          <div className="flex gap-3">
            <button type="button" onClick={goBack} className="text-abakus-blue hover:underline text-sm">
              Back
            </button>
            <button type="button" onClick={goNext} className="bg-abakus-blue text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity">
              Next: Choose Data
            </button>
          </div>
        </div>
      )}

      {step === 'charts' && (
        <div className="flex flex-col items-center gap-6 w-full">
          <p className="text-abakus-light-grey text-sm text-center max-w-md">
            Nothing is included by default -- check whatever ACS and BLS data you want in the deck.
          </p>
          <ChartTopicPicker sections={ACS_SECTIONS} titleFor={(key) => CHART_META[key]?.title ?? key} selected={acsCharts} onChange={setAcsCharts} />
          <ChartTopicPicker sections={BLS_SECTIONS} titleFor={(key) => blsChartMeta(key).title} selected={blsCharts} onChange={setBlsCharts} />
          <div className="flex gap-3">
            <button type="button" onClick={goBack} className="text-abakus-blue hover:underline text-sm">
              Back
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={totalSelected === 0}
              className="bg-abakus-blue text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              Next{nextStep ? `: ${nextStep.label}` : ''} ({totalSelected} selected)
            </button>
          </div>
        </div>
      )}

      {step === 'comparison' && (
        <div className="flex flex-col items-center gap-6 w-full">
          <p className="text-xs text-abakus-light-grey text-center max-w-sm">
            Select up to {MAX_COMPARISON_SIZE} comparison {geoType === 'place' ? 'places' : 'counties'} -- each is its
            own geography here (not itself a region, even if your subject above is). Choosing which data to compare
            is independent of what you picked in the previous step.
          </p>
          <div className="w-full max-w-lg flex justify-center">
            <GeographyList key={geoType} geoType={geoType} selectedGeoids={comparisonGeoids} onToggle={toggleComparisonGeo} maxSelect={MAX_COMPARISON_SIZE} />
          </div>
          {comparisonGeoids.length > 0 && (
            <p className="text-abakus-charcoal text-sm text-center">
              {comparisonGeoids.length} selected:{' '}
              <span className="font-medium">{comparisonGeoids.map((g) => comparisonGeoLabels[g] ?? g).join(', ')}</span>
            </p>
          )}
          <ChartTopicPicker
            sections={ACS_SECTIONS}
            titleFor={(key) => CHART_META[key]?.title ?? key}
            selected={comparisonAcsCharts}
            onChange={setComparisonAcsCharts}
          />
          <ChartTopicPicker
            sections={BLS_SECTIONS}
            titleFor={(key) => blsChartMeta(key).title}
            selected={comparisonBlsCharts}
            onChange={setComparisonBlsCharts}
          />

          <div className="flex gap-3">
            <button type="button" onClick={goBack} className="text-abakus-blue hover:underline text-sm">
              Back
            </button>
            <button type="button" onClick={goNext} className="bg-abakus-blue text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity">
              Next{nextStep ? `: ${nextStep.label}` : ''}
            </button>
          </div>
        </div>
      )}

      {step === 'costar' && (
        <div className="flex flex-col items-center gap-6 w-full">
          <p className="text-abakus-light-grey text-sm text-center max-w-md">
            Upload data for {regionLabel || 'your subject geography'} for whichever of the sections you selected in
            step 1 -- everything here is optional per-field too, so you can still leave individual uploads blank.
          </p>

          {enableHeartbeat && (
            <div className="flex flex-col items-center gap-2 w-full max-w-lg">
              <p className="text-sm font-medium text-abakus-charcoal self-start">Heartbeat (property export)</p>
              <FileUploadSlot file={heartbeatFile} onFileChange={setHeartbeatFile} accept=".xlsx,.xls" />
            </div>
          )}

          {enableMarketOverview && (
            <div className="flex flex-col items-center gap-2 w-full">
              <p className="text-sm font-medium text-abakus-charcoal self-start max-w-lg">Market Overview (data grids)</p>
              <CostarMarketUploader markets={marketOverviewMarkets} onChange={setMarketOverviewMarkets} />
            </div>
          )}

          {enableSmartre && (
          <div className="flex flex-col items-center gap-3 w-full max-w-lg border-t border-abakus-charcoal/10 pt-6">
            <p className="text-sm font-medium text-abakus-charcoal self-start">SmartRE Sales (adds to Housing Analysis)</p>
            <MultiFileUploader items={smartreItems} onChange={setSmartreItems} maxItems={20} withNames={false} accept=".xlsx,.xls,.csv" />
            <button
              type="button"
              onClick={loadSmartreSubdivisions}
              disabled={smartreFiles.length === 0 || smartreLoadingSubs}
              className="text-abakus-blue hover:underline text-sm disabled:opacity-40"
            >
              {smartreLoadingSubs ? 'Loading...' : 'Load Subdivisions'}
            </button>
            {smartreSubdivisions && (
              <div className="w-full flex flex-col gap-2">
                <p className="text-xs text-abakus-light-grey text-center">
                  {smartreSelected.length} selected of {smartreSubdivisions.length} subdivisions found
                </p>
                <div className="max-h-56 overflow-y-auto border border-abakus-charcoal/10 rounded-lg divide-y divide-abakus-charcoal/5">
                  {smartreSubdivisions.map((s) => (
                    <label key={s.name} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-abakus-cream cursor-pointer">
                      <span className="flex items-center gap-2">
                        <input type="checkbox" checked={smartreSelected.includes(s.name)} onChange={() => toggleSmartreSubdivision(s.name)} />
                        <span>{s.name}</span>
                      </span>
                      <span className="text-abakus-light-grey text-xs shrink-0">
                        {s.count} sale{s.count === 1 ? '' : 's'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}

          {enableComparison && (enableHeartbeat || enableMarketOverview) && comparisonGeoids.length > 0 && (
            <div className="flex flex-col items-center gap-4 w-full border-t border-abakus-charcoal/10 pt-6">
              <p className="text-sm font-medium text-abakus-charcoal">
                CoStar for comparison geographies (optional, adds labeled slides to the same CRE section)
              </p>
              {comparisonGeoids.map((g) => (
                <div key={g} className="flex flex-col items-center gap-2 w-full max-w-lg bg-white rounded-xl border border-abakus-charcoal/10 p-4">
                  <p className="text-sm text-abakus-charcoal font-medium">{comparisonGeoLabels[g] ?? g}</p>
                  {enableHeartbeat && (
                    <FileUploadSlot
                      file={comparisonHeartbeatFiles[g] ?? null}
                      onFileChange={(f) => setComparisonHeartbeatFiles((prev) => ({ ...prev, [g]: f }))}
                      accept=".xlsx,.xls"
                    />
                  )}
                  {enableMarketOverview && (
                    <CostarMarketUploader markets={comparisonMarketsFor(g)} onChange={(markets) => setComparisonMarketsFor(g, markets)} />
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={goBack} className="text-abakus-blue hover:underline text-sm">
              Back
            </button>
            <button type="button" onClick={goNext} className="bg-abakus-blue text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity">
              Next: Generate
            </button>
          </div>
        </div>
      )}

      {step === 'generate' && selectedGeoids.length > 0 && (
        <div className="flex flex-col items-center gap-4">
          <label className="flex flex-col items-center gap-1 w-full max-w-sm">
            <span className="text-sm text-abakus-charcoal self-start">Report name (optional)</span>
            <input
              type="text"
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              placeholder={regionLabel}
              className="border border-abakus-charcoal/20 rounded-lg px-3 py-2 bg-white text-sm w-full"
            />
            <span className="text-xs text-abakus-light-grey self-start">Printed on the title slide -- leave blank to use the geography name.</span>
          </label>
          <p className="text-abakus-charcoal text-center">
            Ready to generate a deck for <span className="font-medium">{regionLabel}</span> ({startYear}-{endYear}),{' '}
            {totalSelected} chart{totalSelected === 1 ? '' : 's'} selected.
          </p>
          {enableComparison && comparisonGeoids.length > 0 && (
            <p className="text-abakus-charcoal text-center text-sm">
              Comparing against {comparisonGeoids.length} geograph{comparisonGeoids.length === 1 ? 'y' : 'ies'} (
              {comparisonAcsCharts.length + comparisonBlsCharts.length} chart
              {comparisonAcsCharts.length + comparisonBlsCharts.length === 1 ? '' : 's'} selected for that section).
            </p>
          )}
          {(heartbeatFile || readyMarkets.length > 0) && (
            <p className="text-abakus-charcoal text-center text-sm">
              Commercial Real Estate Analysis section: {heartbeatFile ? 'Heartbeat property export' : null}
              {heartbeatFile && readyMarkets.length > 0 ? ' + ' : null}
              {readyMarkets.length > 0 ? `${readyMarkets.length} market${readyMarkets.length === 1 ? '' : 's'}` : null}.
            </p>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={goBack} className="text-abakus-blue hover:underline text-sm">
              Back
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={loading}
              className="bg-abakus-green text-white font-medium px-6 py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {loading ? 'Generating...' : 'Generate Deck'}
            </button>
          </div>
          {error && <p className="text-abakus-warm-400 text-sm text-center">{error}</p>}
        </div>
      )}

      <Link to="/" className="text-abakus-blue hover:underline text-sm mt-auto">
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

function YearSelect({ value, onChange, min = MIN_YEAR, max = MAX_YEAR }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const years = []
  for (let y = MIN_YEAR; y <= MAX_YEAR; y++) years.push(y)
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="border border-abakus-charcoal/20 rounded-lg px-2 py-1 bg-white">
      {years.map((y) => (
        <option key={y} value={y} disabled={y < min || y > max}>
          {y}
        </option>
      ))}
    </select>
  )
}
