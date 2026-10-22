CREATE TABLE automation_execution_runs (
    run_id UUID PRIMARY KEY REFERENCES automation_flow_runs(id) ON DELETE CASCADE,
    source JSONB NOT NULL,
    identity JSONB NOT NULL,
    policy VARCHAR(24) NOT NULL CHECK (policy IN ('before','inline','background')),
    event_key TEXT NOT NULL UNIQUE,
    definition JSONB NOT NULL,
    owner UUID,
    lease_until TIMESTAMPTZ,
    fence BIGINT NOT NULL DEFAULT 0,
    error_kind TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE automation_execution_tokens (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES automation_flow_runs(id) ON DELETE CASCADE,
    instance_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE,
    parent_token_id UUID REFERENCES automation_execution_tokens(id),
    node_key VARCHAR(96) NOT NULL,
    status VARCHAR(24) NOT NULL,
    outputs JSONB NOT NULL DEFAULT '{}',
    depth INTEGER NOT NULL DEFAULT 0,
    sequence BIGSERIAL,
    parallel_group UUID,
    visit_id UUID,
    attempt INTEGER NOT NULL DEFAULT 1,
    error_message TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_execution_tokens_run ON automation_execution_tokens(run_id,status,sequence);
CREATE INDEX idx_execution_tokens_instance ON automation_execution_tokens(instance_id,status);
CREATE INDEX idx_execution_claim ON automation_execution_runs(lease_until,policy);
ALTER TABLE automation_flow_run_nodes ADD COLUMN IF NOT EXISTS visit_id UUID;
ALTER TABLE automation_flow_run_nodes ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1;
CREATE TABLE automation_execution_audits (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES automation_flow_runs(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL,
    action TEXT NOT NULL,
    detail JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE workflow_notification_dispatch (
    notification_id UUID PRIMARY KEY REFERENCES workflow_notifications(id) ON DELETE CASCADE,
    task_uuid TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Existing task IDs remain readable until the explicit maintenance command
-- deletes old instances. Their old tokens are deliberately not converted.
ALTER TABLE workflow_tasks DROP CONSTRAINT IF EXISTS workflow_tasks_branch_token_id_fkey;


-- Administrative maintenance can connect as another role. Keep new execution
-- tables owned by the existing application's table owner so normal startup
-- retains its established migration privileges.
DO $$
DECLARE application_owner TEXT; table_name TEXT;
BEGIN
    SELECT pg_get_userbyid(c.relowner) INTO application_owner
    FROM pg_class c WHERE c.oid='automation_flows'::regclass;
    FOREACH table_name IN ARRAY ARRAY['automation_execution_runs','automation_execution_tokens','automation_execution_audits','workflow_notification_dispatch']
    LOOP
        EXECUTE format('ALTER TABLE %I OWNER TO %I',table_name,application_owner);
    END LOOP;
END $$;
