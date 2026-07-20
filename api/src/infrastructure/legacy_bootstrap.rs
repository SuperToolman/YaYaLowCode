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

    // Keep development databases recoverable when an earlier migration was recorded as
    // applied but its physical metadata table was removed or never committed.
    db.execute_unprepared(
        r#"
        CREATE TABLE IF NOT EXISTS form_storage_definitions (
          id uuid PRIMARY KEY,
          form_uuid varchar(40) NOT NULL UNIQUE,
          storage_mode varchar(24) NOT NULL DEFAULT 'dynamic_table',
          physical_table varchar(63) NOT NULL,
          compiled_schema_version integer NOT NULL,
          column_mapping_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_form_storage_definitions_mode
          ON form_storage_definitions (storage_mode);
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
        CREATE TABLE IF NOT EXISTS form_views (
          id uuid PRIMARY KEY,
          form_uuid varchar(40) NOT NULL REFERENCES form_definitions(form_uuid) ON DELETE CASCADE,
          view_uuid varchar(40) NOT NULL,
          name varchar(120) NOT NULL,
          config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL,
          UNIQUE(form_uuid, view_uuid)
        );
        CREATE INDEX IF NOT EXISTS idx_form_views_form
          ON form_views (form_uuid, updated_at DESC);
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
        ALTER TABLE agent_sessions
            ADD COLUMN IF NOT EXISTS agent_id VARCHAR(80) NOT NULL DEFAULT 'agent-default';
        CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent_id
            ON agent_sessions (agent_id, updated_at DESC);

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

pub(crate) async fn ensure_identity_tables(db: &DatabaseConnection) -> Result<(), AppError> {
    db.execute_unprepared(
        r#"
        CREATE TABLE IF NOT EXISTS organization_units (
            id UUID PRIMARY KEY,
            source_type VARCHAR(32) NOT NULL,
            external_id VARCHAR(128) NOT NULL,
            parent_external_id VARCHAR(128),
            name VARCHAR(160) NOT NULL,
            sort_order BIGINT NOT NULL DEFAULT 0,
            status VARCHAR(24) NOT NULL DEFAULT 'active',
            raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            UNIQUE (source_type, external_id)
        );
        CREATE INDEX IF NOT EXISTS idx_organization_units_source_parent
            ON organization_units (source_type, parent_external_id, sort_order);

        CREATE TABLE IF NOT EXISTS iam_users (
            id UUID PRIMARY KEY,
            display_name VARCHAR(120) NOT NULL,
            mobile VARCHAR(40),
            email VARCHAR(160),
            avatar_url TEXT,
            job_number VARCHAR(80),
            title VARCHAR(120),
            status VARCHAR(24) NOT NULL DEFAULT 'active',
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        );
        ALTER TABLE iam_users ADD COLUMN IF NOT EXISTS state_code VARCHAR(16);
        ALTER TABLE iam_users ADD COLUMN IF NOT EXISTS telephone VARCHAR(40);
        ALTER TABLE iam_users ADD COLUMN IF NOT EXISTS work_place VARCHAR(160);
        ALTER TABLE iam_users ADD COLUMN IF NOT EXISTS remark TEXT;
        ALTER TABLE iam_users ADD COLUMN IF NOT EXISTS hired_at TIMESTAMPTZ;
        ALTER TABLE iam_users ADD COLUMN IF NOT EXISTS manager_external_user_id VARCHAR(128);
        ALTER TABLE iam_users ADD COLUMN IF NOT EXISTS primary_organization_unit_id UUID REFERENCES organization_units(id) ON DELETE SET NULL;
        ALTER TABLE iam_users ADD COLUMN IF NOT EXISTS senior BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE iam_users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE iam_users ADD COLUMN IF NOT EXISTS is_boss BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE iam_users ADD COLUMN IF NOT EXISTS real_authed BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE iam_users ADD COLUMN IF NOT EXISTS extension_json JSONB NOT NULL DEFAULT '{}'::jsonb;
        -- Keep this idempotent bootstrap for databases created before the multi-email migration.
        -- It also protects upgrades where an older migration history has already been recorded.
        CREATE TABLE IF NOT EXISTS iam_user_email_addresses (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES iam_users(id) ON DELETE CASCADE,
            label VARCHAR(80) NOT NULL,
            email VARCHAR(160) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            UNIQUE (user_id, email)
        );
        CREATE INDEX IF NOT EXISTS idx_iam_user_email_addresses_user_id
            ON iam_user_email_addresses (user_id);
        CREATE TABLE IF NOT EXISTS iam_local_credentials (user_id UUID PRIMARY KEY REFERENCES iam_users(id) ON DELETE CASCADE, username VARCHAR(80) NOT NULL UNIQUE, password TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL);
        CREATE TABLE IF NOT EXISTS iam_external_identities (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES iam_users(id) ON DELETE CASCADE,
            provider VARCHAR(32) NOT NULL,
            external_user_id VARCHAR(128) NOT NULL,
            union_id VARCHAR(128),
            raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            UNIQUE (provider, external_user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_iam_external_identities_user
            ON iam_external_identities (user_id);
        CREATE TABLE IF NOT EXISTS iam_organization_memberships (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES iam_users(id) ON DELETE CASCADE,
            organization_unit_id UUID NOT NULL REFERENCES organization_units(id) ON DELETE CASCADE,
            is_primary BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL,
            UNIQUE (user_id, organization_unit_id)
        );
        CREATE INDEX IF NOT EXISTS idx_iam_memberships_organization
            ON iam_organization_memberships (organization_unit_id, user_id);

        CREATE TABLE IF NOT EXISTS iam_roles (
            id UUID PRIMARY KEY,
            source_type VARCHAR(32) NOT NULL,
            external_id VARCHAR(128) NOT NULL,
            name VARCHAR(120) NOT NULL,
            status VARCHAR(24) NOT NULL DEFAULT 'active',
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            UNIQUE (source_type, external_id)
        );
        CREATE TABLE IF NOT EXISTS iam_user_roles (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES iam_users(id) ON DELETE CASCADE,
            role_id UUID NOT NULL REFERENCES iam_roles(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL,
            UNIQUE (user_id, role_id)
        );
        CREATE INDEX IF NOT EXISTS idx_iam_user_roles_role
            ON iam_user_roles (role_id, user_id);
        "#,
    )
    .await?;
    db.execute_unprepared(
        r#"
        INSERT INTO iam_users (
            id, display_name, status, is_admin, is_boss, real_authed, extension_json, created_at, updated_at
        ) VALUES (
            '00000000-0000-4000-8000-000000000001',
            'YaYa 超级管理员',
            'active',
            TRUE,
            TRUE,
            TRUE,
            '{"protected": true, "source": "local"}'::jsonb,
            NOW(),
            NOW()
        ) ON CONFLICT (id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            status = 'active',
            is_admin = TRUE,
            is_boss = TRUE,
            real_authed = TRUE,
            extension_json = iam_users.extension_json || '{"protected": true, "source": "local"}'::jsonb,
            updated_at = NOW();
        "#,
    )
    .await?;
    db.execute_unprepared("INSERT INTO iam_local_credentials (user_id, username, password, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', 'yaya', 'yaya', NOW(), NOW()) ON CONFLICT (user_id) DO UPDATE SET username = 'yaya', password = 'yaya', updated_at = NOW();").await?;
    db.execute_unprepared(
        r#"
        INSERT INTO iam_external_identities (
            id, user_id, provider, external_user_id, raw_json, created_at, updated_at
        ) VALUES (
            '00000000-0000-4000-8000-000000000004',
            '00000000-0000-4000-8000-000000000001',
            'local',
            'yaya',
            '{"protected": true, "source": "local"}'::jsonb,
            NOW(),
            NOW()
        ) ON CONFLICT (provider, external_user_id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            raw_json = iam_external_identities.raw_json || '{"protected": true, "source": "local"}'::jsonb,
            updated_at = NOW();

        INSERT INTO iam_roles (
            id, source_type, external_id, name, status, created_at, updated_at
        ) VALUES (
            '00000000-0000-4000-8000-000000000002',
            'local',
            'system-administrator',
            '系统管理员',
            'active',
            NOW(),
            NOW()
        ) ON CONFLICT (source_type, external_id) DO UPDATE SET
            name = EXCLUDED.name,
            status = 'active',
            updated_at = NOW();

        INSERT INTO iam_user_roles (id, user_id, role_id, created_at)
        SELECT
            '00000000-0000-4000-8000-000000000003',
            '00000000-0000-4000-8000-000000000001',
            id,
            NOW()
        FROM iam_roles
        WHERE source_type = 'local' AND external_id = 'system-administrator'
        ON CONFLICT (user_id, role_id) DO NOTHING;
        "#,
    )
    .await?;
    Ok(())
}
