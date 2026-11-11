ALTER TABLE agent_v2_runs DROP CONSTRAINT IF EXISTS agent_v2_runs_status_check;
ALTER TABLE agent_v2_runs ADD CONSTRAINT agent_v2_runs_status_check CHECK(status IN ('queued','running','retry_wait','waiting_confirmation','cancel_requested','cancelled','completed','failed','manual_review'));
CREATE TABLE IF NOT EXISTS agent_v2_confirmations (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES agent_v2_sessions(id),
 run_id uuid NOT NULL REFERENCES agent_v2_runs(id), call_id text NOT NULL,
 tenant_id uuid NOT NULL, owner_user_id uuid NOT NULL, employee_id text NOT NULL,
 tool_name text NOT NULL, arguments jsonb NOT NULL, arguments_hash text NOT NULL,
 resource_version text NOT NULL, preview jsonb NOT NULL, policy_version integer NOT NULL DEFAULT 1,
 status text NOT NULL CHECK(status IN ('pending','approved','rejected','expired','cancelled','executed','conflict')),
 expires_at timestamptz NOT NULL, resolved_at timestamptz, resolved_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,call_id)
);
CREATE INDEX IF NOT EXISTS agent_v2_confirmations_pending ON agent_v2_confirmations(expires_at) WHERE status='pending';
CREATE TABLE IF NOT EXISTS agent_v2_effects (
 effect_key uuid PRIMARY KEY REFERENCES agent_v2_confirmations(id),
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_v2_tool_audit (
 id uuid PRIMARY KEY, confirmation_id uuid NOT NULL REFERENCES agent_v2_confirmations(id),
 actor_user_id uuid NOT NULL, action text NOT NULL, outcome text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
