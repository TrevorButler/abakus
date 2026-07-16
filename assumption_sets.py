"""
assumption_sets.py

Plain SQL CRUD against the assumption_sets table (see schema_v1.sql) -- a
generic admin-editable key/label/value/notes store, already used for the
housing-demand turnover tiers and now extended to BLS office-demand
coefficients (schema_bls.sql's seed rows). No FastAPI imports -- mirrors
app_users.py's pure-data-module style.
"""

from sqlalchemy import text


def get_assumption(engine, key: str) -> dict | None:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT key, label, value, notes FROM assumption_sets WHERE key = :key"),
            {"key": key},
        ).first()
    return dict(row._mapping) if row else None


def list_assumptions(engine, key_prefix: str | None = None) -> list[dict]:
    with engine.connect() as conn:
        if key_prefix:
            rows = conn.execute(
                text("SELECT key, label, value, notes FROM assumption_sets WHERE key LIKE :prefix ORDER BY key"),
                {"prefix": f"{key_prefix}%"},
            )
        else:
            rows = conn.execute(text("SELECT key, label, value, notes FROM assumption_sets ORDER BY key"))
        return [dict(r._mapping) for r in rows]


def upsert_assumption(engine, key: str, label: str, value: float, notes: str | None) -> dict:
    with engine.begin() as conn:
        row = conn.execute(
            text("""
                INSERT INTO assumption_sets (key, label, value, notes)
                VALUES (:key, :label, :value, :notes)
                ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, value = EXCLUDED.value, notes = EXCLUDED.notes
                RETURNING key, label, value, notes
            """),
            {"key": key, "label": label, "value": value, "notes": notes},
        ).first()
        return dict(row._mapping)


def delete_assumption(engine, key: str) -> None:
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM assumption_sets WHERE key = :key"), {"key": key})
