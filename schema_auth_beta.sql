-- Census Dashboard — adds a 'beta' role tier (delta on top of schema_auth.sql)
-- Applied by hand, once, to both the local and production databases --
-- same constraint-widening pattern schema_puma.sql used for geography.geo_type.
--
-- 'beta' sits between 'user' and 'admin': same allowlist-only sign-in as
-- everyone else, but sees WIP modules gated behind require_beta_or_admin
-- (see auth.py) that a plain 'user' doesn't. 'admin' already implies this --
-- require_beta_or_admin checks role IN ('beta', 'admin') -- so promoting
-- someone to admin was already a superset and needs no separate grant.

ALTER TABLE app_users DROP CONSTRAINT app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('user', 'beta', 'admin'));
