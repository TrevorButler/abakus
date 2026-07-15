"""
seed_admins.py

One-off idempotent seed of the two initial admin accounts into app_users.
Run once against local DATABASE_URL and once against production (point
DATABASE_URL at the Render Postgres "External Database URL" for that run).
Resolves the chicken-and-egg problem of needing an admin to use the
/admin UI that doesn't exist without one yet.
"""

import demographics_dashboard as dd
from app_users import add_user

SEED_ADMINS = ["tmb22208@gmail.com", "trevor@kbagroup.com"]


def seed():
    engine = dd.get_engine()
    for email in SEED_ADMINS:
        user = add_user(engine, email, "admin", added_by="seed_admins.py")
        print(f"Seeded {user['email']} as {user['role']}")


if __name__ == "__main__":
    seed()
