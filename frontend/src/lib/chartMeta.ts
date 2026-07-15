// Display titles and value formatting per chart, matching the names used
// in Guide to Abakus - Structure, Sources and Transformations.pdf. All
// "stacked_bar" charts from the API are percentages (0-1 fractions); all
// "line" charts are either a count, a dollar figure, or an age in years --
// format is chart-specific, keyed here rather than inferred.

export type ValueFormat = 'count' | 'dollars' | 'years' | 'percent'

export interface ChartMeta {
  title: string
  format: ValueFormat
}

export const CHART_META: Record<string, ChartMeta> = {
  population: { title: 'Population', format: 'count' },
  households: { title: 'Households', format: 'count' },
  housing_units: { title: 'Housing Units', format: 'count' },
  housing_unit_occupancy: { title: 'Housing Unit Occupancy', format: 'percent' },
  housing_unit_type: { title: 'Housing Unit Type', format: 'percent' },
  housing_unit_type_simplified: { title: 'Housing Unit Type (Simplified)', format: 'percent' },
  year_built: { title: 'Year Built', format: 'percent' },
  year_moved_in: { title: 'Year Moved In', format: 'percent' },
  tenure: { title: 'Tenure', format: 'percent' },
  median_home_value: { title: 'Median Home Value', format: 'dollars' },
  median_rent: { title: 'Median Rent', format: 'dollars' },
  owner_cost_burden: { title: 'Owner Cost Burden', format: 'percent' },
  renter_cost_burden: { title: 'Renter Cost Burden', format: 'percent' },
  age_by_cohort: { title: 'Age by Cohort', format: 'percent' },
  age_by_cohort_simplified: { title: 'Age by Cohort (Simplified)', format: 'percent' },
  median_age: { title: 'Median Age', format: 'years' },
  race: { title: 'Race', format: 'percent' },
  hispanic_ethnicity: { title: 'Hispanic Ethnicity', format: 'percent' },
  household_income: { title: 'Household Income', format: 'percent' },
  household_income_simplified: { title: 'Household Income (Simplified)', format: 'percent' },
  median_household_income: { title: 'Median Household Income', format: 'dollars' },
  tenure_by_age_owner: { title: 'Tenure by Age -- Owner', format: 'percent' },
  tenure_by_age_renter: { title: 'Tenure by Age -- Renter', format: 'percent' },
  tenure_by_income_owner: { title: 'Tenure by Income -- Owner', format: 'percent' },
  tenure_by_income_renter: { title: 'Tenure by Income -- Renter', format: 'percent' },
  household_size: { title: 'Household Size', format: 'percent' },
  household_type: { title: 'Household Type', format: 'percent' },
}

export function formatValue(value: number, format: ValueFormat): string {
  switch (format) {
    case 'percent':
      return `${(value * 100).toFixed(1)}%`
    case 'dollars':
      return `$${Math.round(value).toLocaleString()}`
    case 'years':
      return value.toFixed(1)
    case 'count':
      return Math.round(value).toLocaleString()
  }
}

// Distinct, colorblind-reasonable palette for stacked bar segments, drawn
// from the Abakus primary + secondary warm palette (abakus_visualguide.pdf).
export const CATEGORY_COLORS = [
  '#36bfee', '#fbab34', '#85c66b', '#f7a097', '#4f4e52',
  '#f3b968', '#eba39a', '#e17466', '#262628', '#f7d3a1',
]
