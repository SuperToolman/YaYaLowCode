ALTER TABLE agent_v2_sessions ADD COLUMN IF NOT EXISTS fork_origin jsonb;
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS history_snapshot boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS agent_v2_forks (
 tenant_id uuid NOT NULL, user_id uuid NOT NULL, client_id uuid NOT NULL,
 source_session_id uuid NOT NULL, source_message_id uuid NOT NULL, target_session_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,user_id,client_id)
);
