-- Census Dashboard — Auth schema (delta on top of schema_v1.sql)
-- Applied by hand, once, to both the local and production databases --
-- schema_v1.sql was already run once against both and has no IF NOT EXISTS
-- guards, so this stays a separate file rather than being appended to it.

CREATE TABLE app_users (
    email        TEXT PRIMARY KEY,
    role         VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    added_by     TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
