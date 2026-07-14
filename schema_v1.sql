-- Census Dashboard — Schema v1
-- Scope: ACS 5-year estimates only, Places + Counties, 7 states (AL, FL, GA, NC, OK, SC, TN), 2010-2024

-- ============================================================
-- 1. GEOGRAPHY — resolved from crosswalk + Census Gazetteer FIPS lookup
-- ============================================================
CREATE TABLE geography (
    geoid           VARCHAR(7)  PRIMARY KEY,  -- state FIPS + place/county FIPS
    geo_type        VARCHAR(10) NOT NULL CHECK (geo_type IN ('place', 'county')),
    name            TEXT NOT NULL,             -- e.g. "Jonesboro"
    name_lsad       TEXT NOT NULL,             -- e.g. "Jonesboro city"
    display_name    TEXT NOT NULL,             -- e.g. "Jonesboro city, Georgia" (disambiguated where needed)
    state_abbr      CHAR(2) NOT NULL,
    state_name      TEXT NOT NULL,
    county_geoid    VARCHAR(5),                -- NULL for county rows; FK to a county's own geoid for place rows
    is_ambiguous    BOOLEAN NOT NULL DEFAULT FALSE  -- flags the 46 duplicate-name places
);

CREATE INDEX idx_geography_state ON geography(state_abbr);
CREATE INDEX idx_geography_type ON geography(geo_type);
CREATE INDEX idx_geography_county ON geography(county_geoid);

-- ============================================================
-- 2. ACS ESTIMATES — long/normalized fact table, raw values only
-- ============================================================
CREATE TABLE acs_estimates (
    geoid           VARCHAR(7) NOT NULL REFERENCES geography(geoid),
    year            SMALLINT NOT NULL,          -- ACS 5-year vintage, e.g. 2024
    table_id        VARCHAR(10) NOT NULL,       -- e.g. 'DP04', 'B19037'
    variable_code   VARCHAR(20) NOT NULL,       -- raw Census variable id, e.g. 'DP04_0001'
    variable_label  TEXT NOT NULL,              -- human-readable, e.g. 'Total housing units'
    estimate        NUMERIC,
    moe             NUMERIC,                    -- margin of error, NULL where N/A
    PRIMARY KEY (geoid, year, table_id, variable_code)
);

CREATE INDEX idx_estimates_geo_year ON acs_estimates(geoid, year);
CREATE INDEX idx_estimates_table ON acs_estimates(table_id, variable_code);

-- ============================================================
-- 3. ASSUMPTIONS / CONFIG — expert assumptions, editable without redeploy
-- (populated later, not needed for the dashboard build)
-- ============================================================
CREATE TABLE assumption_sets (
    key             VARCHAR(50) PRIMARY KEY,    -- e.g. 'internal_turnover'
    label           TEXT NOT NULL,               -- e.g. 'Standard Internal Turnover'
    value           NUMERIC NOT NULL,            -- e.g. 0.0025
    notes           TEXT
);

-- ============================================================
-- 4. COMPARATIVE COMMUNITIES CACHE (optional, for Assessor performance)
-- Precomputed per geo_type + year, avoids O(n^2) SSD calc on every request
-- ============================================================
CREATE TABLE comparison_metrics (
    geoid           VARCHAR(7) NOT NULL REFERENCES geography(geoid),
    year            SMALLINT NOT NULL,
    housing_units   NUMERIC,
    households      NUMERIC,
    median_income   NUMERIC,
    PRIMARY KEY (geoid, year)
);

-- ============================================================
-- 5. GEOGRAPHY NEIGHBORS — precomputed centroid-to-centroid distances for
-- the gravity-model housing demand projection. Static (recomputed on the
-- same cadence as a geography refresh, not per-query). Symmetric: both
-- (A,B) and (B,A) are stored so "neighbors of X" is a plain WHERE lookup.
-- ============================================================
CREATE TABLE geography_neighbors (
    subject_geoid           VARCHAR(7) NOT NULL REFERENCES geography(geoid),
    neighbor_geoid           VARCHAR(7) NOT NULL REFERENCES geography(geoid),
    centroid_distance_miles NUMERIC NOT NULL,
    PRIMARY KEY (subject_geoid, neighbor_geoid),
    CHECK (subject_geoid <> neighbor_geoid)
);

CREATE INDEX idx_geography_neighbors_subject ON geography_neighbors(subject_geoid);
