CREATE TABLE automation_execution_record_changes (
    run_id UUID NOT NULL REFERENCES automation_flow_runs(id) ON DELETE CASCADE,
    form_uuid TEXT NOT NULL,
    record_uuid TEXT NOT NULL,
    record_id UUID NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT '',
    record_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    record_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    branch_id UUID,
    changed_fields JSONB NOT NULL DEFAULT '[]',
    operation VARCHAR(16) NOT NULL CHECK (operation IN ('upsert', 'delete')),
    base_data JSONB,
    record_data JSONB,
    base_updated_at TIMESTAMPTZ,
    operator TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (run_id, form_uuid, record_uuid),
    CHECK ((operation = 'delete' AND record_data IS NULL) OR
           (operation = 'upsert' AND record_data IS NOT NULL))
);
CREATE INDEX idx_automation_execution_record_changes_form
    ON automation_execution_record_changes(run_id, form_uuid);

CREATE TABLE automation_execution_parallel_groups (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES automation_flow_runs(id) ON DELETE CASCADE,
    parent_group UUID REFERENCES automation_execution_parallel_groups(id) ON DELETE CASCADE,
    parent_branch_id UUID,
    fork_token_id UUID NOT NULL REFERENCES automation_execution_tokens(id) ON DELETE CASCADE,
    status VARCHAR(24) NOT NULL CHECK (status IN ('running', 'joining', 'completed', 'failed', 'cancelled')),
    expected_branches JSONB NOT NULL DEFAULT '[]',
    arrived_branches JSONB NOT NULL DEFAULT '[]',
    join_node_key VARCHAR(96),
    merged_outputs JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_automation_execution_parallel_groups_run
    ON automation_execution_parallel_groups(run_id, status);

CREATE TABLE automation_execution_external_effects (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES automation_flow_runs(id) ON DELETE CASCADE,
    token_id UUID NOT NULL REFERENCES automation_execution_tokens(id) ON DELETE CASCADE,
    node_key VARCHAR(96) NOT NULL,
    sequence BIGSERIAL,
    status VARCHAR(24) NOT NULL CHECK (status IN ('requesting', 'uncertain', 'completed', 'compensating', 'compensated', 'failed', 'manual')),
    compensation JSONB,
    request_config JSONB,
    request_context JSONB NOT NULL DEFAULT '{}',
    result_json JSONB,
    error_message TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_automation_execution_external_effects_run
    ON automation_execution_external_effects(run_id, sequence DESC);

DO $$
DECLARE application_owner TEXT;
BEGIN
    SELECT pg_get_userbyid(c.relowner) INTO application_owner
    FROM pg_class c WHERE c.oid='automation_flows'::regclass;
    EXECUTE format('ALTER TABLE automation_execution_record_changes OWNER TO %I', application_owner);
    EXECUTE format('ALTER TABLE automation_execution_parallel_groups OWNER TO %I', application_owner);
    EXECUTE format('ALTER TABLE automation_execution_external_effects OWNER TO %I', application_owner);
END $$;
