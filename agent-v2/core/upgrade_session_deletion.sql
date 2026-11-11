ALTER TABLE agent_v2_sessions ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;
CREATE TABLE IF NOT EXISTS agent_v2_session_deletions(
 session_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL, employee_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','running','failed','completed')), error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
