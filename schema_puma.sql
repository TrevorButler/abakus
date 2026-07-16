-- Census Dashboard — PUMA/PUMS schema (delta on top of schema_v1.sql + schema_bls.sql)
-- Applied by hand to local + prod, same convention as schema_auth.sql/schema_bls.sql.

ALTER TABLE geography DROP CONSTRAINT geography_geo_type_check;
ALTER TABLE geography ADD CONSTRAINT geography_geo_type_check CHECK (geo_type IN ('place', 'county', 'puma'));

-- geoid was VARCHAR(7) (state FIPS(2) + a 5-digit local code, for both
-- county and place rows). PUMA codes are ALSO a 5-digit code drawn from
-- Census's own independent numbering -- confirmed empirically that a bare
-- "state+PUMA-code" geoid collides with an existing place geoid (Census
-- assigns place FIPS and PUMA codes from unrelated namespaces, so overlap
-- is real, not hypothetical: '0100100' is both a PUMA code and an existing
-- Alabama place's geoid). PUMA geoids are disambiguated with a "P" prefix
-- (build_pumas_geo_assets.py), so every geoid column that stores or
-- references a geography.geoid needs to widen from 7 to 10 characters to
-- fit "P" + a 7-char geoid + headroom.
ALTER TABLE geography ALTER COLUMN geoid TYPE VARCHAR(10);
ALTER TABLE acs_estimates ALTER COLUMN geoid TYPE VARCHAR(10);
ALTER TABLE bls_qcew_estimates ALTER COLUMN geoid TYPE VARCHAR(10);
ALTER TABLE geography_neighbors ALTER COLUMN subject_geoid TYPE VARCHAR(10);
ALTER TABLE geography_neighbors ALTER COLUMN neighbor_geoid TYPE VARCHAR(10);
ALTER TABLE comparison_metrics ALTER COLUMN geoid TYPE VARCHAR(10);

CREATE TABLE pums_households (
    serialno         VARCHAR(13) NOT NULL,
    vintage          SMALLINT NOT NULL,               -- 5-year PUMS end year (2024 for the 2020-2024 file)
    geoid            VARCHAR(10) NOT NULL REFERENCES geography(geoid),  -- "P" + state FIPS(2) + PUMA code(5)
    wgtp             INTEGER NOT NULL,
    wgtp_replicates  INTEGER[80] NOT NULL,             -- WGTP1..WGTP80, in order
    np               SMALLINT,
    bld              SMALLINT,
    bdsp             SMALLINT,
    nrc              SMALLINT,
    ten              SMALLINT,
    hincp            NUMERIC,                          -- stored now (unused this phase) so future $-based averages don't need a backfill
    adjinc           NUMERIC,
    adjhsg           NUMERIC,
    PRIMARY KEY (vintage, serialno)
);

CREATE INDEX idx_pums_households_geoid_vintage ON pums_households(geoid, vintage);
CREATE INDEX idx_pums_households_bld ON pums_households(bld);
