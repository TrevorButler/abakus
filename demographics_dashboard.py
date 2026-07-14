"""
demographics_dashboard.py

Implements every chart in the Demographics Dashboard section of "Guide to
Abakus - Structure, Sources and Transformations.pdf" (project root, pages
17-43).

Two chart shapes, matching the frontend's own display rule (Abakus User
Experience Outline.docx): a single data point per geography per year is a
line chart; multiple category values per year is a stacked bar chart. This
collapses the PDF's "Longitudinal" vs "Two-Period Comparison" tags for
single-value metrics -- both render as a line, so both are served the same
way (full year range; the frontend picks how much of it to show, including
a mandated two-endpoint-year view for Comparative Analysis).

For multi-category charts, this module always returns the FULL requested
year range, not just two endpoint years -- the "isolate one sub-variable"
interaction in the UX outline turns a stacked bar into a line chart, which
needs every year's value for that one category, not just two.

Census data-format quirks handled explicitly here, all found empirically
(none are documented in the PDF's own per-table change log):
    - DP05's variable *codes* are not stable across vintages -- unlike
      every other table used in this project, Census has inserted new
      detailed race/tribal/ethnic-group breakdowns into the middle of the
      table more than once (a major restructure at the 2017 vintage, and
      again between the 2022 and 2024 vintages), which shifts every code
      number after the insertion point. DP04_0018 e.g. is "18 years and
      over" in 2010-2016 but "Median age (years)" in 2017+. DP04, S1101,
      S1901, B25007, B25118, and S2501 codes were all individually spot-
      checked across the full 2010-2024 range and are semantically stable
      (formatting/word-order varies, but a given code always means the
      same thing) -- this is a DP05-specific problem, handled by
      resolving every DP05 variable per-year by matching normalized label
      text rather than trusting a fixed code (see _resolve_dp05).
    - B25007/B25118 hierarchy labels aren't used here (exact variable codes
      were confirmed directly instead), so the 2019-vintage colon-drift
      that affected B19037 in housing_demand_projections.py doesn't apply.
    - S2501's household-size/type figures are a PERCENT of occupied housing
      units through 2016 and a raw COUNT from 2017 on, for the same
      variable codes -- see household_size() / household_type().
    - S1901's income-bin variables (S1901_C01_002 through _011) are
      themselves already percentages (e.g. a stored value of 4.3 means
      4.3%), not raw counts -- see household_income().
"""

import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/census_dashboard")


def get_engine():
    return create_engine(DATABASE_URL)


def fetch_multi(engine, geoid: str, table_id: str, variable_codes: list, start_year: int, end_year: int) -> dict:
    """Returns {year: {variable_code: value}}."""
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT year, variable_code, estimate FROM acs_estimates
                WHERE geoid = :geoid AND table_id = :table_id AND variable_code = ANY(:codes)
                  AND year BETWEEN :start AND :end
            """),
            {"geoid": geoid, "table_id": table_id, "codes": variable_codes, "start": start_year, "end": end_year},
        )
        data = {}
        for row in rows:
            if row.estimate is not None:
                data.setdefault(row.year, {})[row.variable_code] = float(row.estimate)
        return data


def direct_series(engine, geoid: str, table_id: str, variable_code: str, start_year: int, end_year: int) -> dict:
    """A single value per year -- always a line chart. Used for Population,
    Households, Housing Units, Median Home Value, Median Rent, Median Age,
    Median Household Income."""
    data = fetch_multi(engine, geoid, table_id, [variable_code], start_year, end_year)
    return {
        "chart_type": "line",
        "series": {year: values[variable_code] for year, values in data.items() if variable_code in values},
    }


def category_breakdown(engine, geoid: str, table_id: str, numerator_codes: dict,
                        denominator_code: str, start_year: int, end_year: int,
                        most_recent_year_only: bool = False) -> dict:
    """numerator_codes: {category_label: variable_code}. Returns
    {chart_type: "stacked_bar", categories: {year: {category_label: percent}}}."""
    all_codes = list(numerator_codes.values()) + [denominator_code]
    data = fetch_multi(engine, geoid, table_id, all_codes, start_year, end_year)

    categories = {}
    for year, values in data.items():
        denom = values.get(denominator_code)
        if not denom:
            continue
        year_result = {}
        for label, code in numerator_codes.items():
            if code in values:
                year_result[label] = values[code] / denom
        if year_result:
            categories[year] = year_result

    if most_recent_year_only and categories:
        latest = max(categories)
        categories = {latest: categories[latest]}

    return {"chart_type": "stacked_bar", "categories": categories}


def regroup_categories(breakdown: dict, group_map: dict) -> dict:
    """Consolidates a category_breakdown() result's categories into coarser
    groups by summing, e.g. 13 age bins -> 4 simplified age groups.
    group_map: {new_group_label: [original_category_labels]}."""
    regrouped = {}
    for year, cats in breakdown["categories"].items():
        year_result = {}
        for group_label, original_labels in group_map.items():
            total = sum(cats.get(label, 0.0) for label in original_labels)
            year_result[group_label] = total
        regrouped[year] = year_result
    return {"chart_type": "stacked_bar", "categories": regrouped}


# ============================================================
# Population, Households, Housing Units -- single value per year, line chart
# ============================================================

def population(engine, geoid, start_year, end_year):
    return direct_series(engine, geoid, "DP05", "DP05_0001", start_year, end_year)


def households(engine, geoid, start_year, end_year):
    return direct_series(engine, geoid, "S1101", "S1101_C01_001", start_year, end_year)


def housing_units(engine, geoid, start_year, end_year):
    return direct_series(engine, geoid, "DP04", "DP04_0001", start_year, end_year)


# ============================================================
# Housing characteristics (DP04)
#
# DP04_0001-0015 (HOUSING OCCUPANCY, UNITS IN STRUCTURE) are stable across
# 2010-2024 and used directly by code above. Everything from YEAR STRUCTURE
# BUILT onward is NOT -- HOUSING TENURE, VALUE, MORTGAGE STATUS, and GROSS
# RENT all reshuffled codes at least once (a restructure by 2017, then
# further drift for the rent section specifically by 2022), the same class
# of bug as DP05 -- see module docstring. Resolved by label suffix here,
# since a plain "ends with" match (like DP05 uses) is ambiguous where two
# sections share bin text (SMOCAPI and GRAPI both have "25.0 to 29.9
# percent" bins, e.g.), hence starts_with+ends_with matching.
# ============================================================

def _normalize_dp04_label(label: str) -> str:
    parts = [p.rstrip(":") for p in label.split("!!")]
    parts = [p for p in parts if p not in ("Estimate", "Percent")]
    return "!!".join(parts)


def _fetch_dp04_by_label(engine, geoid: str, start_year: int, end_year: int) -> dict:
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT year, variable_label, estimate FROM acs_estimates
                WHERE geoid = :geoid AND table_id = 'DP04' AND year BETWEEN :start AND :end
                  AND variable_code NOT LIKE '%P'
            """),
            {"geoid": geoid, "start": start_year, "end": end_year},
        )
        data = {}
        for row in rows:
            if row.estimate is not None:
                data.setdefault(row.year, {})[_normalize_dp04_label(row.variable_label)] = float(row.estimate)
        return data


def _find_dp04(year_values: dict, starts_with: str = None, ends_with: str = None):
    matches = [
        v for k, v in year_values.items()
        if (starts_with is None or k.startswith(starts_with)) and (ends_with is None or k.endswith(ends_with))
    ]
    return matches[0] if len(matches) == 1 else None


def tenure(engine, geoid, start_year, end_year):
    data = _fetch_dp04_by_label(engine, geoid, start_year, end_year)
    categories = {}
    for year, values in data.items():
        denom = _find_dp04(values, starts_with="HOUSING TENURE", ends_with="Occupied housing units")
        owner = _find_dp04(values, ends_with="Owner-occupied")
        renter = _find_dp04(values, ends_with="Renter-occupied")
        if denom and owner is not None and renter is not None:
            categories[year] = {"Owner-occupied": owner / denom, "Renter-occupied": renter / denom}
    return {"chart_type": "stacked_bar", "categories": categories}


def median_home_value(engine, geoid, start_year, end_year):
    data = _fetch_dp04_by_label(engine, geoid, start_year, end_year)
    series = {}
    for year, values in data.items():
        v = _find_dp04(values, starts_with="VALUE", ends_with="Median (dollars)")
        if v is not None:
            series[year] = v
    return {"chart_type": "line", "series": series}


def median_rent(engine, geoid, start_year, end_year):
    data = _fetch_dp04_by_label(engine, geoid, start_year, end_year)
    series = {}
    for year, values in data.items():
        v = _find_dp04(values, starts_with="GROSS RENT", ends_with="Median (dollars)")
        if v is not None:
            series[year] = v
    return {"chart_type": "line", "series": series}


def owner_cost_burden(engine, geoid, start_year, end_year):
    # "with a mortgage" and "without a mortgage" subsections share several
    # bin labels ("25.0 to 29.9 percent" etc appear in both) -- starts_with
    # has to include "with a mortgage" itself, not just the top section
    # header, or the match is ambiguous and silently returns nothing.
    bins = ["Less than 20.0 percent", "20.0 to 24.9 percent", "25.0 to 29.9 percent",
            "30.0 to 34.9 percent", "35.0 percent or more"]
    header = "SELECTED MONTHLY OWNER COSTS AS A PERCENTAGE OF HOUSEHOLD INCOME (SMOCAPI)!!Housing units with a mortgage"
    data = _fetch_dp04_by_label(engine, geoid, start_year, end_year)
    categories = {}
    for year, values in data.items():
        denom = _find_dp04(values, starts_with=header, ends_with="excluding units where SMOCAPI cannot be computed)")
        if not denom:
            continue
        year_result = {}
        for label in bins:
            v = _find_dp04(values, starts_with=header, ends_with=label)
            if v is not None:
                year_result[label] = v / denom
        if year_result:
            categories[year] = year_result
    return {"chart_type": "stacked_bar", "categories": categories}


def renter_cost_burden(engine, geoid, start_year, end_year):
    bins = ["Less than 15.0 percent", "15.0 to 19.9 percent", "20.0 to 24.9 percent",
            "25.0 to 29.9 percent", "30.0 to 34.9 percent", "35.0 percent or more"]
    header = "GROSS RENT AS A PERCENTAGE OF HOUSEHOLD INCOME (GRAPI)"
    data = _fetch_dp04_by_label(engine, geoid, start_year, end_year)
    categories = {}
    for year, values in data.items():
        denom = _find_dp04(values, starts_with=header, ends_with="excluding units where GRAPI cannot be computed)")
        if not denom:
            continue
        year_result = {}
        for label in bins:
            v = _find_dp04(values, starts_with=header, ends_with=label)
            if v is not None:
                year_result[label] = v / denom
        if year_result:
            categories[year] = year_result
    return {"chart_type": "stacked_bar", "categories": categories}


def housing_unit_occupancy(engine, geoid, start_year, end_year):
    return category_breakdown(
        engine, geoid, "DP04",
        {"Occupied housing units": "DP04_0002", "Vacant housing units": "DP04_0003"},
        "DP04_0001", start_year, end_year,
    )


HOUSING_UNIT_TYPE_CODES = {
    "1-unit, detached": "DP04_0007", "1-unit, attached": "DP04_0008", "2 units": "DP04_0009",
    "3 or 4 units": "DP04_0010", "5 to 9 units": "DP04_0011", "10 to 19 units": "DP04_0012",
    "20 or more units": "DP04_0013", "Mobile home": "DP04_0014", "Boat, RV, van, etc.": "DP04_0015",
}


def housing_unit_type(engine, geoid, start_year, end_year):
    return category_breakdown(engine, geoid, "DP04", HOUSING_UNIT_TYPE_CODES, "DP04_0006", start_year, end_year)


def housing_unit_type_simplified(engine, geoid, start_year, end_year):
    raw = housing_unit_type(engine, geoid, start_year, end_year)
    return regroup_categories(raw, {
        "SFD": ["1-unit, detached"],
        "SFA": ["1-unit, attached"],
        "Small MF": ["2 units", "3 or 4 units", "5 to 9 units", "10 to 19 units"],
        "Large MF": ["20 or more units"],
        "Other": ["Mobile home", "Boat, RV, van, etc."],
    })


def year_built(engine, geoid, start_year, end_year):
    codes = {
        "Built 2020 or later": "DP04_0017", "Built 2010 to 2019": "DP04_0018", "Built 2000 to 2009": "DP04_0019",
        "Built 1990 to 1999": "DP04_0020", "Built 1980 to 1989": "DP04_0021", "Built 1970 to 1979": "DP04_0022",
        "Built 1960 to 1969": "DP04_0023", "Built 1950 to 1959": "DP04_0024", "Built 1940 to 1949": "DP04_0025",
        "Built 1939 or earlier": "DP04_0026",
    }
    return category_breakdown(engine, geoid, "DP04", codes, "DP04_0016", start_year, end_year, most_recent_year_only=True)


def year_moved_in(engine, geoid, start_year, end_year):
    codes = {
        "Moved in 2021 or later": "DP04_0051", "Moved in 2018 to 2020": "DP04_0052",
        "Moved in 2010 to 2017": "DP04_0053", "Moved in 2000 to 2009": "DP04_0054",
        "Moved in 1990 to 1999": "DP04_0055", "Moved in 1989 and earlier": "DP04_0056",
    }
    return category_breakdown(engine, geoid, "DP04", codes, "DP04_0050", start_year, end_year, most_recent_year_only=True)


# home_value_distribution / rent_paid_distribution: bin *definitions*
# themselves changed across vintages (e.g. top rent bin was "$1,500 or
# more" in 2012, "$3,000 or more" by 2022), not just codes -- these can't
# be shown consistently across years the way other breakdowns can. Both
# are also marked "Not currently included in Abakus" in the source PDF
# (never shipped in the legacy tool), so -- like Year Built / Year Moved
# In, which have the same genuine bin-redefinition problem -- these are
# restricted to the most recent year only, sidestepping the incompatibility.
def home_value_distribution(engine, geoid, start_year, end_year):
    codes = {
        "Less than $50,000": "DP04_0081", "$50,000 to $99,999": "DP04_0082", "$100,000 to $149,999": "DP04_0083",
        "$150,000 to $199,999": "DP04_0084", "$200,000 to $299,999": "DP04_0085", "$300,000 to $499,999": "DP04_0086",
        "$500,000 to $999,999": "DP04_0087", "$1,000,000 or more": "DP04_0088",
    }
    return category_breakdown(engine, geoid, "DP04", codes, "DP04_0080", start_year, end_year, most_recent_year_only=True)


def rent_paid_distribution(engine, geoid, start_year, end_year):
    codes = {
        "Less than $500": "DP04_0127", "$500 to $999": "DP04_0128", "$1,000 to $1,499": "DP04_0129",
        "$1,500 to $1,999": "DP04_0130", "$2,000 to $2,499": "DP04_0131", "$2,500 to $2,999": "DP04_0132",
        "$3,000 or more": "DP04_0133",
    }
    return category_breakdown(engine, geoid, "DP04", codes, "DP04_0126", start_year, end_year, most_recent_year_only=True)


# ============================================================
# Demographics (DP05) -- resolved by label text per year, not fixed codes.
# See module docstring: DP05 code numbering shifts across vintages in a way
# no other table used in this project does.
# ============================================================

_DP05_CATEGORY_HEADERS = {"SEX AND AGE", "RACE", "HISPANIC OR LATINO AND RACE"}


def _normalize_dp05_label(label: str) -> str:
    parts = [p.rstrip(":") for p in label.split("!!")]
    parts = [p for p in parts if p not in ("Estimate", "Percent")]
    if parts and parts[0] in _DP05_CATEGORY_HEADERS:
        parts = parts[1:]
    if len(parts) > 1 and parts[0] == "Total population":
        parts = parts[1:]
    # Census's own capitalization for a given category isn't even stable
    # across vintages ("Some Other Race" vs "Some other race") -- match
    # case-insensitively.
    return "!!".join(parts).lower()


def _fetch_dp05_by_label(engine, geoid: str, start_year: int, end_year: int) -> dict:
    """Returns {year: {normalized_label: value}}, resolved by label text so
    it's immune to DP05's code-number drift across vintages."""
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT year, variable_label, estimate FROM acs_estimates
                WHERE geoid = :geoid AND table_id = 'DP05' AND year BETWEEN :start AND :end
                  AND variable_code NOT LIKE '%P'
            """),
            {"geoid": geoid, "start": start_year, "end": end_year},
        )
        data = {}
        for row in rows:
            if row.estimate is not None:
                data.setdefault(row.year, {})[_normalize_dp05_label(row.variable_label)] = float(row.estimate)
        return data


def _dp05_category_breakdown(engine, geoid, numerator_labels: dict, denominator_label: str, start_year, end_year) -> dict:
    """Same shape as category_breakdown() but resolves DP05 variables by label.
    numerator_labels/denominator_label are matched case-insensitively."""
    data = _fetch_dp05_by_label(engine, geoid, start_year, end_year)
    denominator_key = denominator_label.lower()
    categories = {}
    for year, values in data.items():
        denom = values.get(denominator_key)
        if not denom:
            continue
        year_result = {}
        for label, key in numerator_labels.items():
            key = key.lower()
            if key in values:
                year_result[label] = values[key] / denom
        if year_result:
            categories[year] = year_result
    return {"chart_type": "stacked_bar", "categories": categories}


def population(engine, geoid, start_year, end_year):
    data = _fetch_dp05_by_label(engine, geoid, start_year, end_year)
    key = "total population"
    return {"chart_type": "line", "series": {y: v[key] for y, v in data.items() if key in v}}


AGE_COHORT_LABELS = {
    "Under 5 years": "Under 5 years", "5 to 9 years": "5 to 9 years", "10 to 14 years": "10 to 14 years",
    "15 to 19 years": "15 to 19 years", "20 to 24 years": "20 to 24 years", "25 to 34 years": "25 to 34 years",
    "35 to 44 years": "35 to 44 years", "45 to 54 years": "45 to 54 years", "55 to 59 years": "55 to 59 years",
    "60 to 64 years": "60 to 64 years", "65 to 74 years": "65 to 74 years", "75 to 84 years": "75 to 84 years",
    "85 years and over": "85 years and over",
}


def age_by_cohort(engine, geoid, start_year, end_year):
    return _dp05_category_breakdown(engine, geoid, AGE_COHORT_LABELS, "Total population", start_year, end_year)


def age_by_cohort_simplified(engine, geoid, start_year, end_year):
    raw = age_by_cohort(engine, geoid, start_year, end_year)
    return regroup_categories(raw, {
        "Under 20": ["Under 5 years", "5 to 9 years", "10 to 14 years", "15 to 19 years"],
        "20 to 45": ["20 to 24 years", "25 to 34 years", "35 to 44 years"],
        "45 to 65": ["45 to 54 years", "55 to 59 years", "60 to 64 years"],
        "65 and Over": ["65 to 74 years", "75 to 84 years", "85 years and over"],
    })


def median_age(engine, geoid, start_year, end_year):
    data = _fetch_dp05_by_label(engine, geoid, start_year, end_year)
    key = "median age (years)"
    return {"chart_type": "line", "series": {y: v[key] for y, v in data.items() if key in v}}


def race(engine, geoid, start_year, end_year):
    labels = {
        "White": "One race!!White", "Black or African American": "One race!!Black or African American",
        "American Indian and Alaska Native": "One race!!American Indian and Alaska Native",
        "Asian": "One race!!Asian",
        "Native Hawaiian and Other Pacific Islander": "One race!!Native Hawaiian and Other Pacific Islander",
        "Some Other Race": "One race!!Some Other Race",
    }
    return _dp05_category_breakdown(engine, geoid, labels, "One race", start_year, end_year)


def hispanic_ethnicity(engine, geoid, start_year, end_year):
    labels = {"Hispanic or Latino (of any race)": "Hispanic or Latino (of any race)", "Not Hispanic or Latino": "Not Hispanic or Latino"}
    return _dp05_category_breakdown(engine, geoid, labels, "Total population", start_year, end_year)


# ============================================================
# Income (S1901)
# ============================================================

HOUSEHOLD_INCOME_CODES = {
    "Less than $10,000": "S1901_C01_002", "$10,000 to $14,999": "S1901_C01_003",
    "$15,000 to $24,999": "S1901_C01_004", "$25,000 to $34,999": "S1901_C01_005",
    "$35,000 to $49,999": "S1901_C01_006", "$50,000 to $74,999": "S1901_C01_007",
    "$75,000 to $99,999": "S1901_C01_008", "$100,000 to $149,999": "S1901_C01_009",
    "$150,000 to $199,999": "S1901_C01_010", "$200,000 or more": "S1901_C01_011",
}


def household_income(engine, geoid, start_year, end_year):
    # S1901's income-bin variables are already percentages (e.g. 4.3 means
    # 4.3%), unlike every other category_breakdown() table here -- dividing
    # by S1901_C01_001 (Total households, a raw count) would be wrong.
    data = fetch_multi(engine, geoid, "S1901", list(HOUSEHOLD_INCOME_CODES.values()), start_year, end_year)
    categories = {}
    for year, values in data.items():
        year_result = {label: values[code] / 100.0 for label, code in HOUSEHOLD_INCOME_CODES.items() if code in values}
        if year_result:
            categories[year] = year_result
    return {"chart_type": "stacked_bar", "categories": categories}


def household_income_simplified(engine, geoid, start_year, end_year):
    raw = household_income(engine, geoid, start_year, end_year)
    return regroup_categories(raw, {
        "Less than $35,000": ["Less than $10,000", "$10,000 to $14,999", "$15,000 to $24,999", "$25,000 to $34,999"],
        "$35,000 to $50,000": ["$35,000 to $49,999"],
        "$50,000 to $75,000": ["$50,000 to $74,999"],
        "$75,000 to $100,000": ["$75,000 to $99,999"],
        "$100,000 to $150,000": ["$100,000 to $149,999"],
        "$150,000 or more": ["$150,000 to $199,999", "$200,000 or more"],
    })


def median_household_income(engine, geoid, start_year, end_year):
    return direct_series(engine, geoid, "S1901", "S1901_C01_012", start_year, end_year)


# ============================================================
# Tenure by age / income (B25007, B25118) -- denominator differs by section
# ============================================================

def _tenure_breakdown(engine, geoid, table_id, owner_denom, owner_codes, renter_denom, renter_codes, start_year, end_year):
    all_codes = [owner_denom, renter_denom] + list(owner_codes.values()) + list(renter_codes.values())
    data = fetch_multi(engine, geoid, table_id, all_codes, start_year, end_year)

    categories = {}
    for year, values in data.items():
        year_result = {}
        owner_total = values.get(owner_denom)
        if owner_total:
            for label, code in owner_codes.items():
                if code in values:
                    year_result[f"Owner: {label}"] = values[code] / owner_total
        renter_total = values.get(renter_denom)
        if renter_total:
            for label, code in renter_codes.items():
                if code in values:
                    year_result[f"Renter: {label}"] = values[code] / renter_total
        if year_result:
            categories[year] = year_result

    return {"chart_type": "stacked_bar", "categories": categories}


def tenure_by_age(engine, geoid, start_year, end_year):
    owner_codes = {
        "15 to 24 years": "B25007_003", "25 to 34 years": "B25007_004", "35 to 44 years": "B25007_005",
        "45 to 54 years": "B25007_006", "55 to 59 years": "B25007_007", "60 to 64 years": "B25007_008",
        "65 to 74 years": "B25007_009", "75 to 84 years": "B25007_010", "85 years and over": "B25007_011",
    }
    renter_codes = {
        "15 to 24 years": "B25007_013", "25 to 34 years": "B25007_014", "35 to 44 years": "B25007_015",
        "45 to 54 years": "B25007_016", "55 to 59 years": "B25007_017", "60 to 64 years": "B25007_018",
        "65 to 74 years": "B25007_019", "75 to 84 years": "B25007_020", "85 years and over": "B25007_021",
    }
    return _tenure_breakdown(engine, geoid, "B25007", "B25007_002", owner_codes, "B25007_012", renter_codes, start_year, end_year)


def tenure_by_income(engine, geoid, start_year, end_year):
    owner_codes = {
        "Less than $5,000": "B25118_003", "$5,000 to $9,999": "B25118_004", "$10,000 to $14,999": "B25118_005",
        "$15,000 to $19,999": "B25118_006", "$20,000 to $24,999": "B25118_007", "$25,000 to $34,999": "B25118_008",
        "$35,000 to $49,999": "B25118_009", "$50,000 to $74,999": "B25118_010", "$75,000 to $99,999": "B25118_011",
        "$100,000 to $149,999": "B25118_012", "$150,000 or more": "B25118_013",
    }
    renter_codes = {
        "Less than $5,000": "B25118_015", "$5,000 to $9,999": "B25118_016", "$10,000 to $14,999": "B25118_017",
        "$15,000 to $19,999": "B25118_018", "$20,000 to $24,999": "B25118_019", "$25,000 to $34,999": "B25118_020",
        "$35,000 to $49,999": "B25118_021", "$50,000 to $74,999": "B25118_022", "$75,000 to $99,999": "B25118_023",
        "$100,000 to $149,999": "B25118_024", "$150,000 or more": "B25118_025",
    }
    return _tenure_breakdown(engine, geoid, "B25118", "B25118_002", owner_codes, "B25118_014", renter_codes, start_year, end_year)


# ============================================================
# Household size / type (S2501) -- format changed from percent (<=2016) to
# whole number (2017+) for the SAME variable codes; normalize both to a
# 0-1 fraction of occupied housing units.
# ============================================================

S2501_FORMAT_CHANGE_YEAR = 2017


def _s2501_breakdown(engine, geoid, numerator_codes: dict, start_year, end_year):
    occupied_code = "S2501_C01_001"
    all_codes = [occupied_code] + list(numerator_codes.values())
    data = fetch_multi(engine, geoid, "S2501", all_codes, start_year, end_year)

    categories = {}
    for year, values in data.items():
        occupied = values.get(occupied_code)
        if not occupied:
            continue
        year_result = {}
        for label, code in numerator_codes.items():
            if code not in values:
                continue
            raw = values[code]
            if year >= S2501_FORMAT_CHANGE_YEAR:
                year_result[label] = raw / occupied  # raw is a count
            else:
                year_result[label] = raw / 100.0  # raw is already a percent (e.g. 37.2 = 37.2%)
        if year_result:
            categories[year] = year_result

    return {"chart_type": "stacked_bar", "categories": categories}


def household_size(engine, geoid, start_year, end_year):
    codes = {
        "1-person household": "S2501_C01_002", "2-person household": "S2501_C01_003",
        "3-person household": "S2501_C01_004", "4-or-more-person household": "S2501_C01_005",
    }
    return _s2501_breakdown(engine, geoid, codes, start_year, end_year)


def household_type(engine, geoid, start_year, end_year):
    codes = {"Family households": "S2501_C01_009", "Nonfamily households": "S2501_C01_023"}
    return _s2501_breakdown(engine, geoid, codes, start_year, end_year)


# ============================================================
# Full dashboard
# ============================================================

CHART_FUNCTIONS = {
    "population": population, "households": households, "housing_units": housing_units,
    "housing_unit_occupancy": housing_unit_occupancy,
    "housing_unit_type": housing_unit_type, "housing_unit_type_simplified": housing_unit_type_simplified,
    "year_built": year_built, "year_moved_in": year_moved_in,
    "tenure": tenure,
    "median_home_value": median_home_value, "home_value_distribution": home_value_distribution,
    "median_rent": median_rent, "rent_paid_distribution": rent_paid_distribution,
    "owner_cost_burden": owner_cost_burden, "renter_cost_burden": renter_cost_burden,
    "age_by_cohort": age_by_cohort, "age_by_cohort_simplified": age_by_cohort_simplified,
    "median_age": median_age,
    "race": race, "hispanic_ethnicity": hispanic_ethnicity,
    "household_income": household_income, "household_income_simplified": household_income_simplified,
    "median_household_income": median_household_income,
    "tenure_by_age": tenure_by_age, "tenure_by_income": tenure_by_income,
    "household_size": household_size, "household_type": household_type,
}


def get_full_dashboard(geoid: str, start_year: int, end_year: int, engine=None) -> dict:
    engine = engine or get_engine()
    return {name: func(engine, geoid, start_year, end_year) for name, func in CHART_FUNCTIONS.items()}
