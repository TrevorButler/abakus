"""
app_users.py

Plain SQL CRUD against the app_users allowlist table (see schema_auth.sql).
No FastAPI imports -- mirrors the demographics_dashboard.py /
housing_demand_projections.py / comparative_communities.py pattern of pure
data modules that take an already-built engine, with the HTTP layer living
in api.py / auth.py instead.
"""

from sqlalchemy import text


def get_user(engine, email: str) -> dict | None:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT email, role, added_by, created_at FROM app_users WHERE email = :email"),
            {"email": email.strip().lower()},
        ).first()
    return dict(row._mapping) if row else None


def list_users(engine) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT email, role, added_by, created_at FROM app_users ORDER BY created_at"))
        return [dict(r._mapping) for r in rows]


def add_user(engine, email: str, role: str, added_by: str | None) -> dict:
    email = email.strip().lower()
    with engine.begin() as conn:
        row = conn.execute(
            text("""
                INSERT INTO app_users (email, role, added_by)
                VALUES (:email, :role, :added_by)
                ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role
                RETURNING email, role, added_by, created_at
            """),
            {"email": email, "role": role, "added_by": added_by},
        ).first()
        return dict(row._mapping)


def delete_user(engine, email: str) -> None:
    email = email.strip().lower()
    with engine.begin() as conn:
        row = conn.execute(text("SELECT role FROM app_users WHERE email = :email"), {"email": email}).first()
        if row is None:
            return
        if row.role == "admin":
            admin_count = conn.execute(text("SELECT count(*) FROM app_users WHERE role = 'admin'")).scalar()
            if admin_count <= 1:
                raise ValueError("Refusing to delete the last remaining admin")
        conn.execute(text("DELETE FROM app_users WHERE email = :email"), {"email": email})
