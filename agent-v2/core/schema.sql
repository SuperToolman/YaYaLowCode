CREATE TABLE agent_v2_sessions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, owner_user_id uuid NOT NULL REFERENCES iam_users(id),
 employee_id text NOT NULL, engine text NOT NULL DEFAULT 'v2' CHECK(engine='v2'),
 title text NOT NULL DEFAULT '新对话', next_seq bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_v2_sessions_scope ON agent_v2_sessions(tenant_id, owner_user_id, employee_id, updated_at DESC, id);
CREATE TABLE agent_v2_commands (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES agent_v2_sessions(id), client_id uuid NOT NULL,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(session_id,client_id)
);
CREATE TABLE agent_v2_runs (
 id uuid PRIMARY KEY REFERENCES agent_v2_commands(id), session_id uuid NOT NULL REFERENCES agent_v2_sessions(id),
 queue_seq bigint NOT NULL, UNIQUE(session_id,queue_seq),
 status text NOT NULL CHECK(status IN ('queued','running','retry_wait','cancel_requested','cancelled','completed','failed')),
 checkpoint jsonb NOT NULL DEFAULT '{}', attempt integer NOT NULL DEFAULT 0,
 lease_owner uuid, lease_epoch bigint NOT NULL DEFAULT 0, lease_until timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(), error_code text,
 context_snapshot jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_v2_runs_claim ON agent_v2_runs(status,available_at,created_at);
CREATE TABLE agent_v2_messages (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES agent_v2_sessions(id), run_id uuid REFERENCES agent_v2_runs(id),
 role text NOT NULL CHECK(role IN('user','assistant')), parts jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,role)
);
CREATE INDEX agent_v2_messages_session ON agent_v2_messages(session_id,created_at,id);
CREATE TABLE agent_v2_steps (
 run_id uuid NOT NULL REFERENCES agent_v2_runs(id), ordinal integer NOT NULL, attempt integer NOT NULL,
 status text NOT NULL, request_snapshot jsonb NOT NULL, response_snapshot jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,ordinal,attempt)
);
CREATE TABLE agent_v2_tool_invocations (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES agent_v2_runs(id), call_id text NOT NULL,
 tool_name text NOT NULL, arguments jsonb NOT NULL, status text NOT NULL, result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,call_id)
);
CREATE TABLE agent_v2_events (
 event_id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES agent_v2_sessions(id), seq bigint NOT NULL,
 run_id uuid REFERENCES agent_v2_runs(id), type text NOT NULL, payload jsonb NOT NULL,
 protocol_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(session_id,seq)
);
CREATE TABLE agent_v2_outbox (
 event_id uuid PRIMARY KEY REFERENCES agent_v2_events(event_id), created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
