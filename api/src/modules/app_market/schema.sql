-- Member-set schema. Obsolete primary-member columns are intentionally removed.
ALTER TABLE market_installations ADD COLUMN IF NOT EXISTS managed_snapshot JSONB;
ALTER TABLE market_installation_resources ADD COLUMN IF NOT EXISTS source_app_id TEXT;
CREATE TABLE IF NOT EXISTS market_installation_members (
 installation_id UUID NOT NULL,
 source_app_id TEXT NOT NULL,
 local_app_id TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 PRIMARY KEY(installation_id,source_app_id)
);
CREATE TABLE IF NOT EXISTS market_publications (
 product_id TEXT PRIMARY KEY,
 submission_id TEXT NOT NULL,
 status TEXT NOT NULL,
 snapshot_json JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Obsolete primary-member fields are removed; installations are member sets.
ALTER TABLE market_installations DROP COLUMN IF EXISTS local_app_id;
ALTER TABLE market_installations DROP COLUMN IF EXISTS legacy_mapping;
ALTER TABLE market_publications DROP COLUMN IF EXISTS root_app_id;
ALTER TABLE market_publications DROP COLUMN IF EXISTS source_context_app_id;
