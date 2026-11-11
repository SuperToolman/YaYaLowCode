ALTER TABLE agent_v2_sessions
 ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS archived_at timestamptz,
 ADD COLUMN IF NOT EXISTS title_custom boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS metadata_version bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS agent_v2_session_directory ON agent_v2_sessions(tenant_id,owner_user_id,employee_id,(archived_at IS NOT NULL),pinned DESC,updated_at DESC,id DESC);
