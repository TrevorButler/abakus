-- Census Dashboard — BLS QCEW schema (delta on top of schema_v1.sql)
-- Applied by hand to local + prod, same convention as schema_auth.sql.

ALTER TABLE geography ADD COLUMN acres NUMERIC;  -- populated only for geo_type='place' rows, via build_place_acreage.py

CREATE TABLE bls_qcew_estimates (
    geoid               VARCHAR(7) NOT NULL REFERENCES geography(geoid),  -- county geoid; QCEW is county-level
    year                SMALLINT NOT NULL,
    naics_code          VARCHAR(6) NOT NULL,     -- '10' (Total, All Industries) or one of the 7 sector codes
    naics_title         TEXT NOT NULL,
    annual_avg_emplvl   NUMERIC,
    total_annual_wages  NUMERIC,
    avg_annual_pay      NUMERIC,                 -- derived at load time as wages/employment, never a passthrough
    PRIMARY KEY (geoid, year, naics_code)
);

CREATE INDEX idx_bls_qcew_geo_year ON bls_qcew_estimates(geoid, year);
CREATE INDEX idx_bls_qcew_naics ON bls_qcew_estimates(naics_code);

-- Seed the 5 office-demand coefficients directly (avoids a chicken-and-egg admin-UI
-- bootstrap problem, same rationale as seed_admins.py for app_users).
INSERT INTO assumption_sets (key, label, value, notes) VALUES
    ('bls_office_sqft_per_professional_employee', 'Sqft per Professional Employee', 150, 'Information, Finance & Insurance, Real Estate, Prof/Tech Services, Management, Admin/Waste'),
    ('bls_office_occupancy_share', 'Office Occupancy Share', 0.60, 'Fraction of professional-sector employment occupying dedicated office space'),
    ('bls_office_sqft_per_medical_employee', 'Sqft per Medical Employee', 600, 'NAICS 62 Health Care & Social Assistance'),
    ('bls_office_medical_multiplier_low', 'Medical Office Multiplier (Low)', 0.47, NULL),
    ('bls_office_medical_multiplier_high', 'Medical Office Multiplier (High)', 0.97, NULL);
