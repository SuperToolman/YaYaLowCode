//! Compatibility schema bootstrap for databases created before the migration set was complete.
//!
//! New schema changes belong in SeaORM migrations. These idempotent statements remain only
//! to keep existing development databases compatible during the transition.

use sea_orm::{ConnectionTrait, DatabaseConnection};

use crate::AppError;

pub(crate) async fn ensure_form_tables(db: &DatabaseConnection) -> Result<(), AppError> {
    db.execute_unprepared(
        r#"
        CREATE TABLE IF NOT EXISTS form_definitions (
          id uuid PRIMARY KEY,
          app_route_app_id varchar(32) NOT NULL,
          form_uuid varchar(40) NOT NULL UNIQUE,
          name varchar(120) NOT NULL,
          slug varchar(80) NOT NULL,
          status varchar(24) NOT NULL,
          draft_schema_version integer NOT NULL DEFAULT 1,
          published_schema_version integer NOT NULL DEFAULT 1,
          latest_schema_version integer NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        ALTER TABLE form_definitions
          ADD COLUMN IF NOT EXISTS draft_schema_version integer NOT NULL DEFAULT 1;
        ALTER TABLE form_definitions
          ADD COLUMN IF NOT EXISTS published_schema_version integer NOT NULL DEFAULT 1;
        UPDATE form_definitions
          SET draft_schema_version = latest_schema_version
          WHERE draft_schema_version IS NULL;
        UPDATE form_definitions
          SET published_schema_version = latest_schema_version
          WHERE published_schema_version IS NULL;
        CREATE INDEX IF NOT EXISTS idx_form_definitions_app_route_app_id
          ON form_definitions (app_route_app_id);
        "#,
    )
    .await?;

    db.execute_unprepared(
        r#"
        CREATE TABLE IF NOT EXISTS form_schemas (
          id uuid PRIMARY KEY,
          form_uuid varchar(40) NOT NULL,
          version integer NOT NULL,
          schema_json jsonb NOT NULL,
          change_log varchar(255),
          published boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        ALTER TABLE form_schemas
          ADD COLUMN IF NOT EXISTS change_log varchar(255);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_form_schemas_form_uuid_version
          ON form_schemas (form_uuid, version);
        "#,
    )
    .await?;

    db.execute_unprepared(
        r#"
        CREATE TABLE IF NOT EXISTS app_navigation_items (
          id uuid PRIMARY KEY,
          app_route_app_id varchar(32) NOT NULL,
          item_type varchar(24) NOT NULL,
          target_form_uuid varchar(40),
          title varchar(120) NOT NULL,
          path_slug varchar(80) NOT NULL,
          sort_order integer NOT NULL DEFAULT 0,
          is_default_entry boolean NOT NULL DEFAULT false,
          parent_id uuid,
          visibility_rule varchar(255),
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_app_navigation_items_app_route_app_id
          ON app_navigation_items (app_route_app_id);
        CREATE INDEX IF NOT EXISTS idx_app_navigation_items_default_entry
          ON app_navigation_items (app_route_app_id, is_default_entry);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_app_navigation_items_target_form_uuid
          ON app_navigation_items (target_form_uuid)
          WHERE target_form_uuid IS NOT NULL;
        "#,
    )
    .await?;

    db.execute_unprepared(
        r#"
        CREATE TABLE IF NOT EXISTS form_records (
          id uuid PRIMARY KEY,
          record_uuid varchar(40) NOT NULL UNIQUE,
          app_route_app_id varchar(32) NOT NULL,
          form_uuid varchar(40) NOT NULL,
          schema_version integer NOT NULL,
          record_data jsonb NOT NULL,
          created_by varchar(80) NOT NULL,
          updated_by varchar(80) NOT NULL,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_form_records_form_uuid_created_at
          ON form_records (form_uuid, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_form_records_app_route_app_id
          ON form_records (app_route_app_id);
        "#,
    )
    .await?;

    Ok(())
}

pub(crate) async fn ensure_automation_tables(db: &DatabaseConnection) -> Result<(), AppError> {
    db.execute_unprepared(
        r#"
        CREATE TABLE IF NOT EXISTS automation_flows (
          id uuid PRIMARY KEY,
          flow_uuid varchar(40) NOT NULL UNIQUE,
          app_route_app_id varchar(32) NOT NULL,
          name varchar(120) NOT NULL,
          description varchar(255),
          status varchar(24) NOT NULL DEFAULT 'draft',
          current_version integer NOT NULL DEFAULT 1,
          trigger_form_uuid varchar(40),
          trigger_event varchar(32) NOT NULL DEFAULT 'after_create',
          trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
          nodes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
          edges_json jsonb NOT NULL DEFAULT '[]'::jsonb,
          created_by varchar(80) NOT NULL,
          updated_by varchar(80) NOT NULL,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_automation_flows_app_route_app_id
          ON automation_flows (app_route_app_id);
        CREATE INDEX IF NOT EXISTS idx_automation_flows_trigger_form_event
          ON automation_flows (trigger_form_uuid, trigger_event);
        ALTER TABLE automation_flows
          ADD COLUMN IF NOT EXISTS current_version integer NOT NULL DEFAULT 1;

        CREATE TABLE IF NOT EXISTS automation_flow_versions (
          id uuid PRIMARY KEY,
          flow_id uuid NOT NULL,
          version integer NOT NULL,
          name varchar(120) NOT NULL,
          description varchar(255),
          status varchar(24) NOT NULL,
          trigger_form_uuid varchar(40),
          trigger_event varchar(32) NOT NULL,
          trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
          nodes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
          edges_json jsonb NOT NULL DEFAULT '[]'::jsonb,
          change_summary varchar(255),
          created_by varchar(80) NOT NULL,
          created_at timestamptz NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_flow_versions_flow_id_version
          ON automation_flow_versions (flow_id, version);

        CREATE TABLE IF NOT EXISTS automation_nodes (
          id uuid PRIMARY KEY,
          flow_id uuid NOT NULL,
          version integer NOT NULL,
          node_key varchar(96) NOT NULL,
          node_kind varchar(40) NOT NULL,
          label varchar(120) NOT NULL,
          description varchar(255),
          position_x double precision NOT NULL,
          position_y double precision NOT NULL,
          config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_nodes_flow_id_version_node_key
          ON automation_nodes (flow_id, version, node_key);

        CREATE TABLE IF NOT EXISTS automation_edges (
          id uuid PRIMARY KEY,
          flow_id uuid NOT NULL,
          version integer NOT NULL,
          edge_key varchar(96) NOT NULL,
          source_node_key varchar(96) NOT NULL,
          target_node_key varchar(96) NOT NULL,
          source_handle varchar(96),
          target_handle varchar(96),
          raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_edges_flow_id_version_edge_key
          ON automation_edges (flow_id, version, edge_key);

        CREATE TABLE IF NOT EXISTS automation_flow_runs (
          id uuid PRIMARY KEY,
          run_uuid varchar(40) NOT NULL UNIQUE,
          flow_id uuid NOT NULL,
          flow_version integer NOT NULL,
          trigger_event varchar(32) NOT NULL,
          trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          status varchar(24) NOT NULL DEFAULT 'running',
          retry_source varchar(24),
          retry_run_uuid varchar(40),
          retry_node_key varchar(96),
          error_message varchar(255),
          started_at timestamptz NOT NULL,
          finished_at timestamptz,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_automation_flow_runs_flow_id_started_at
          ON automation_flow_runs (flow_id, started_at DESC);

        CREATE TABLE IF NOT EXISTS automation_flow_run_nodes (
          id uuid PRIMARY KEY,
          run_id uuid NOT NULL,
          node_key varchar(96) NOT NULL,
          node_kind varchar(40) NOT NULL,
          node_label varchar(120) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'running',
          input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          output_json jsonb,
          error_message varchar(255),
          started_at timestamptz NOT NULL,
          finished_at timestamptz,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_automation_flow_run_nodes_run_id_started_at
          ON automation_flow_run_nodes (run_id, started_at ASC);
        "#,
    )
    .await?;

    Ok(())
}

pub(crate) async fn ensure_agent_tables(db: &DatabaseConnection) -> Result<(), AppError> {
    db.execute_unprepared(
        r#"
        CREATE TABLE IF NOT EXISTS agent_sessions (
            id UUID PRIMARY KEY,
            session_uuid VARCHAR(64) NOT NULL UNIQUE,
            title VARCHAR(160) NOT NULL,
            app_route_app_id VARCHAR(32),
            context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            status VARCHAR(24) NOT NULL DEFAULT 'active',
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated_at
            ON agent_sessions (updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_sessions_app_id
            ON agent_sessions (app_route_app_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS agent_messages (
            id UUID PRIMARY KEY,
            message_uuid VARCHAR(64) NOT NULL UNIQUE,
            session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
            role VARCHAR(24) NOT NULL,
            content TEXT NOT NULL,
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_messages_session_created
            ON agent_messages (session_id, created_at ASC);

        CREATE TABLE IF NOT EXISTS agent_runs (
            id UUID PRIMARY KEY,
            run_uuid VARCHAR(64) NOT NULL UNIQUE,
            session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
            status VARCHAR(24) NOT NULL,
            model VARCHAR(160) NOT NULL,
            prompt_tokens BIGINT NOT NULL DEFAULT 0,
            completion_tokens BIGINT NOT NULL DEFAULT 0,
            error_message TEXT,
            started_at TIMESTAMPTZ NOT NULL,
            completed_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_agent_runs_session_started
            ON agent_runs (session_id, started_at DESC);

        CREATE TABLE IF NOT EXISTS agent_run_steps (
            id UUID PRIMARY KEY,
            run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
            step_index INTEGER NOT NULL,
            step_type VARCHAR(32) NOT NULL,
            name VARCHAR(160) NOT NULL,
            input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            status VARCHAR(24) NOT NULL,
            error_message TEXT,
            started_at TIMESTAMPTZ NOT NULL,
            completed_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run_index
            ON agent_run_steps (run_id, step_index ASC);
        "#,
    )
    .await?;

    Ok(())
}
