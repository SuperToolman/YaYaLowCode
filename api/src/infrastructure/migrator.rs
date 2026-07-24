pub use sea_orm_migration::prelude::*;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260626_000001_create_apps_table::Migration),
            Box::new(m20260626_000002_create_form_definitions_table::Migration),
            Box::new(m20260626_000003_create_form_schemas_table::Migration),
            Box::new(m20260626_000004_create_app_navigation_items_table::Migration),
            Box::new(m20260626_000005_create_form_records_table::Migration),
            Box::new(m20260629_000006_create_automation_flows_table::Migration),
            Box::new(m20260629_000007_add_automation_flow_versions::Migration),
            Box::new(m20260629_000008_create_automation_nodes_table::Migration),
            Box::new(m20260629_000009_create_automation_edges_table::Migration),
            Box::new(m20260713_000010_create_agent_mvp_tables::Migration),
            Box::new(m20260714_000011_create_identity_organization_tables::Migration),
            Box::new(m20260714_000012_create_identity_user_tables::Migration),
            Box::new(m20260714_000013_create_identity_role_tables::Migration),
            Box::new(m20260714_000014_expand_identity_user_profile::Migration),
            Box::new(m20260714_000015_bind_agent_sessions::Migration),
            Box::new(m20260715_000016_create_form_storage_definitions::Migration),
            Box::new(m20260715_000017_drop_shared_form_records::Migration),
            Box::new(m20260715_000018_repair_form_storage_definitions::Migration),
            Box::new(m20260720_000019_create_form_views::Migration),
            Box::new(m20260720_000020_remove_role_groups::Migration),
            Box::new(m20260720_000021_create_user_email_addresses::Migration),
            Box::new(m20260720_000022_create_local_credentials::Migration),
            Box::new(m20260722_000023_add_form_type::Migration),
            Box::new(m20260722_000024_add_automation_flow_type::Migration),
            Box::new(m20260722_000025_create_workflow_runtime_tables::Migration),
            Box::new(m20260722_000026_add_workflow_task_assignee_user::Migration),
            Box::new(m20260723_000027_create_locations_table::Migration),
            Box::new(m20260723_000028_create_uploaded_files_table::Migration),
            Box::new(m20260723_000028_limit_locations_to_three_levels::Migration),
            Box::new(m20260723_000029_convert_locations_to_tree::Migration),
            Box::new(m20260723_000030_repair_locations_tree_schema::Migration),
            Box::new(m20260724_000031_extend_agent_sessions::Migration),
        ]
    }
}

mod m20260724_000031_extend_agent_sessions {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
                ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'general';
                ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;
                CREATE INDEX IF NOT EXISTS idx_agent_sessions_source_updated_at
                    ON agent_sessions (source, is_pinned DESC, updated_at DESC);
            "#).await?;
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260723_000028_create_uploaded_files_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                CREATE TABLE IF NOT EXISTS uploaded_files (
                    id UUID PRIMARY KEY,
                    storage_key TEXT NOT NULL UNIQUE,
                    original_name TEXT NOT NULL,
                    mime_type VARCHAR(255) NOT NULL,
                    byte_size BIGINT NOT NULL,
                    uploaded_by VARCHAR(120) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL
                );
            "#,
                )
                .await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS uploaded_files")
                .await?;
            Ok(())
        }
    }
}

mod m20260723_000027_create_locations_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(
                "CREATE TABLE IF NOT EXISTS locations (
                    id UUID PRIMARY KEY,
                    code VARCHAR(255) NOT NULL UNIQUE,
                    parent_code VARCHAR(255) NULL REFERENCES locations(code) ON DELETE CASCADE,
                    kind VARCHAR(24) NOT NULL,
                    name TEXT NOT NULL,
                    labels JSONB NOT NULL DEFAULT '{}'::jsonb,
                    source VARCHAR(64) NOT NULL DEFAULT 'manual',
                    source_id VARCHAR(255) NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    CONSTRAINT chk_locations_kind CHECK (kind IN ('country', 'region', 'city'))
                );
                CREATE INDEX IF NOT EXISTS idx_locations_parent_kind_sort ON locations (parent_code, kind, sort_order, name);
                CREATE INDEX IF NOT EXISTS idx_locations_country_kind ON locations (kind) WHERE parent_code IS NULL;"
            ).await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS locations;")
                .await?;
            Ok(())
        }
    }
}
mod m20260723_000028_limit_locations_to_three_levels {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(
                "ALTER TABLE locations DROP CONSTRAINT IF EXISTS chk_locations_kind;
                 ALTER TABLE locations ADD CONSTRAINT chk_locations_kind CHECK (kind IN ('country', 'region', 'city'));"
            ).await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(
                "ALTER TABLE locations DROP CONSTRAINT IF EXISTS chk_locations_kind;
                 ALTER TABLE locations ADD CONSTRAINT chk_locations_kind CHECK (kind IN ('country', 'region', 'city', 'district'));"
            ).await?;
            Ok(())
        }
    }
}
mod m20260723_000029_convert_locations_to_tree {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "ALTER TABLE locations ADD COLUMN IF NOT EXISTS parent_id UUID NULL",
                )
                .await?;
            manager
                .get_connection()
                .execute_unprepared("ALTER TABLE locations ADD COLUMN IF NOT EXISTS depth SMALLINT")
                .await?;
            manager.get_connection().execute_unprepared(
                "UPDATE locations AS child SET parent_id = parent.id FROM locations AS parent WHERE child.parent_code = parent.code AND child.parent_id IS NULL;
                 UPDATE locations SET depth = 1 WHERE parent_id IS NULL AND depth IS NULL;
                 WITH RECURSIVE tree AS (
                    SELECT id, 1::SMALLINT AS depth FROM locations WHERE parent_id IS NULL
                    UNION ALL
                    SELECT child.id, (tree.depth + 1)::SMALLINT FROM locations AS child JOIN tree ON child.parent_id = tree.id
                 ) UPDATE locations SET depth = tree.depth FROM tree WHERE locations.id = tree.id;
                 ALTER TABLE locations ALTER COLUMN depth SET NOT NULL;
                 ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_parent_code_fkey;
                 ALTER TABLE locations DROP CONSTRAINT IF EXISTS chk_locations_kind;
                 ALTER TABLE locations ADD CONSTRAINT locations_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES locations(id) ON DELETE CASCADE;
                 ALTER TABLE locations DROP COLUMN IF EXISTS parent_code;
                 CREATE INDEX IF NOT EXISTS idx_locations_parent_depth_sort ON locations (parent_id, depth, sort_order, name);"
            ).await?;
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Err(DbErr::Migration(
                "locations tree migration is irreversible".to_string(),
            ))
        }
    }
}
mod m20260723_000030_repair_locations_tree_schema {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            let connection = manager.get_connection();
            connection
                .execute_unprepared(
                    "ALTER TABLE locations ADD COLUMN IF NOT EXISTS parent_id UUID NULL",
                )
                .await?;
            connection
                .execute_unprepared("ALTER TABLE locations ADD COLUMN IF NOT EXISTS depth SMALLINT")
                .await?;
            connection.execute_unprepared("DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'locations' AND column_name = 'parent_code') THEN UPDATE locations AS child SET parent_id = parent.id FROM locations AS parent WHERE child.parent_code = parent.code AND child.parent_id IS NULL; ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_parent_code_fkey; ALTER TABLE locations DROP COLUMN parent_code; END IF; END $$").await?;
            connection
                .execute_unprepared(
                    "UPDATE locations SET depth = 1 WHERE parent_id IS NULL AND depth IS NULL",
                )
                .await?;
            connection.execute_unprepared("WITH RECURSIVE tree AS (SELECT id, 1::SMALLINT AS calculated_depth FROM locations WHERE parent_id IS NULL UNION ALL SELECT child.id, (tree.calculated_depth + 1)::SMALLINT FROM locations AS child JOIN tree ON child.parent_id = tree.id) UPDATE locations SET depth = tree.calculated_depth FROM tree WHERE locations.id = tree.id").await?;
            connection
                .execute_unprepared("ALTER TABLE locations ALTER COLUMN depth SET NOT NULL")
                .await?;
            connection
                .execute_unprepared(
                    "ALTER TABLE locations DROP CONSTRAINT IF EXISTS chk_locations_kind",
                )
                .await?;
            connection.execute_unprepared("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_parent_id_fkey') THEN ALTER TABLE locations ADD CONSTRAINT locations_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES locations(id) ON DELETE CASCADE; END IF; END $$").await?;
            connection.execute_unprepared("CREATE INDEX IF NOT EXISTS idx_locations_parent_depth_sort ON locations (parent_id, depth, sort_order, name)").await?;
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Err(DbErr::Migration(
                "locations tree schema repair is irreversible".to_string(),
            ))
        }
    }
}
mod m20260722_000026_add_workflow_task_assignee_user {
    use sea_orm_migration::prelude::*;
    #[derive(DeriveMigrationName)]
    pub struct Migration;
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("ALTER TABLE workflow_tasks ADD COLUMN IF NOT EXISTS assignee_user_id UUID REFERENCES iam_users(id) ON DELETE SET NULL; CREATE INDEX IF NOT EXISTS idx_workflow_tasks_assignee_user_status ON workflow_tasks (assignee_user_id, status, created_at DESC);").await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("DROP INDEX IF EXISTS idx_workflow_tasks_assignee_user_status; ALTER TABLE workflow_tasks DROP COLUMN IF EXISTS assignee_user_id;").await?;
            Ok(())
        }
    }
}
mod m20260722_000023_add_form_type {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "ALTER TABLE form_definitions ADD COLUMN IF NOT EXISTS form_type VARCHAR(24) NOT NULL DEFAULT 'normal';",
                )
                .await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("ALTER TABLE form_definitions DROP COLUMN IF EXISTS form_type;")
                .await?;
            Ok(())
        }
    }
}

mod m20260722_000024_add_automation_flow_type {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "ALTER TABLE automation_flows ADD COLUMN IF NOT EXISTS flow_type VARCHAR(24) NOT NULL DEFAULT 'trigger';",
                )
                .await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("ALTER TABLE automation_flows DROP COLUMN IF EXISTS flow_type;")
                .await?;
            Ok(())
        }
    }
}

mod m20260722_000025_create_workflow_runtime_tables {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(
                r#"
                CREATE UNIQUE INDEX IF NOT EXISTS uq_process_flow_per_form
                    ON automation_flows (trigger_form_uuid)
                    WHERE flow_type = 'process';

                CREATE TABLE IF NOT EXISTS workflow_instances (
                    id UUID PRIMARY KEY,
                    instance_uuid VARCHAR(64) NOT NULL UNIQUE,
                    form_uuid VARCHAR(64) NOT NULL,
                    record_uuid VARCHAR(64) NOT NULL,
                    process_flow_id UUID NOT NULL REFERENCES automation_flows(id) ON DELETE RESTRICT,
                    flow_version INTEGER NOT NULL,
                    status VARCHAR(24) NOT NULL,
                    current_node_key VARCHAR(96),
                    submitter VARCHAR(120) NOT NULL,
                    started_at TIMESTAMPTZ NOT NULL,
                    completed_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workflow_instances_record
                    ON workflow_instances (form_uuid, record_uuid, started_at DESC);

                CREATE TABLE IF NOT EXISTS workflow_tasks (
                    id UUID PRIMARY KEY,
                    task_uuid VARCHAR(64) NOT NULL UNIQUE,
                    instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
                    node_key VARCHAR(96) NOT NULL,
                    node_label VARCHAR(160) NOT NULL,
                    task_type VARCHAR(24) NOT NULL,
                    assignee VARCHAR(120) NOT NULL,
                    status VARCHAR(24) NOT NULL,
                    comment TEXT,
                    completed_by VARCHAR(120),
                    completed_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workflow_tasks_assignee_status
                    ON workflow_tasks (assignee, status, created_at DESC);

                CREATE TABLE IF NOT EXISTS workflow_actions (
                    id UUID PRIMARY KEY,
                    instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
                    task_id UUID REFERENCES workflow_tasks(id) ON DELETE SET NULL,
                    action VARCHAR(32) NOT NULL,
                    operator VARCHAR(120) NOT NULL,
                    comment TEXT,
                    created_at TIMESTAMPTZ NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workflow_actions_instance
                    ON workflow_actions (instance_id, created_at ASC);
                "#,
            ).await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(
                "DROP TABLE IF EXISTS workflow_actions; DROP TABLE IF EXISTS workflow_tasks; DROP TABLE IF EXISTS workflow_instances; DROP INDEX IF EXISTS uq_process_flow_per_form;",
            ).await?;
            Ok(())
        }
    }
}
mod m20260720_000022_create_local_credentials {
    use sea_orm_migration::prelude::*;
    #[derive(DeriveMigrationName)]
    pub struct Migration;
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("CREATE TABLE IF NOT EXISTS iam_local_credentials (user_id UUID PRIMARY KEY REFERENCES iam_users(id) ON DELETE CASCADE, username VARCHAR(80) NOT NULL UNIQUE, password TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL);").await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS iam_local_credentials;")
                .await?;
            Ok(())
        }
    }
}

mod m20260720_000021_create_user_email_addresses {
    use sea_orm_migration::prelude::*;
    #[derive(DeriveMigrationName)]
    pub struct Migration;
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
            CREATE TABLE IF NOT EXISTS iam_user_email_addresses (
              id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES iam_users(id) ON DELETE CASCADE,
              label VARCHAR(80) NOT NULL, email VARCHAR(160) NOT NULL,
              created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
              UNIQUE(user_id, email)
            );
            CREATE INDEX IF NOT EXISTS idx_iam_user_email_addresses_user_id ON iam_user_email_addresses(user_id);
        "#).await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS iam_user_email_addresses;")
                .await?;
            Ok(())
        }
    }
}

mod m20260720_000019_create_form_views {
    use sea_orm_migration::prelude::*;
    #[derive(DeriveMigrationName)]
    pub struct Migration;
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
            CREATE TABLE IF NOT EXISTS form_views (
              id UUID PRIMARY KEY, form_uuid VARCHAR(40) NOT NULL REFERENCES form_definitions(form_uuid) ON DELETE CASCADE,
              view_uuid VARCHAR(40) NOT NULL, name VARCHAR(120) NOT NULL, config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, UNIQUE(form_uuid, view_uuid)
            ); CREATE INDEX IF NOT EXISTS idx_form_views_form ON form_views(form_uuid, updated_at DESC);
        "#).await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS form_views;")
                .await?;
            Ok(())
        }
    }
}

mod m20260720_000020_remove_role_groups {
    use sea_orm_migration::prelude::*;
    #[derive(DeriveMigrationName)]
    pub struct Migration;
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("ALTER TABLE iam_roles DROP COLUMN IF EXISTS group_name;")
                .await?;
            Ok(())
        }
        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260715_000018_repair_form_storage_definitions {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                    CREATE TABLE IF NOT EXISTS form_storage_definitions (
                        id UUID PRIMARY KEY,
                        form_uuid VARCHAR(40) NOT NULL UNIQUE,
                        storage_mode VARCHAR(24) NOT NULL DEFAULT 'dynamic_table',
                        physical_table VARCHAR(63) NOT NULL,
                        compiled_schema_version INTEGER NOT NULL,
                        column_mapping_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                        created_at TIMESTAMPTZ NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_form_storage_definitions_mode
                        ON form_storage_definitions (storage_mode);
                    "#,
                )
                .await?;
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260715_000017_drop_shared_form_records {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS form_records;")
                .await?;
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260715_000016_create_form_storage_definitions {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                    CREATE TABLE IF NOT EXISTS form_storage_definitions (
                        id UUID PRIMARY KEY,
                        form_uuid VARCHAR(40) NOT NULL UNIQUE,
                        storage_mode VARCHAR(24) NOT NULL DEFAULT 'dynamic_table',
                        physical_table VARCHAR(63) NOT NULL,
                        compiled_schema_version INTEGER NOT NULL,
                        column_mapping_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                        created_at TIMESTAMPTZ NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_form_storage_definitions_mode
                        ON form_storage_definitions (storage_mode);
                    "#,
                )
                .await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS form_storage_definitions;")
                .await?;
            Ok(())
        }
    }
}

mod m20260714_000015_bind_agent_sessions {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                ALTER TABLE agent_sessions
                    ADD COLUMN IF NOT EXISTS agent_id VARCHAR(80) NOT NULL DEFAULT 'agent-default';
                CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent_id
                    ON agent_sessions (agent_id, updated_at DESC);
                "#,
                )
                .await?;
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260714_000014_expand_identity_user_profile {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
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
                    "#,
                )
                .await?;
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260714_000013_create_identity_role_tables {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                    CREATE TABLE IF NOT EXISTS iam_roles (
                        id UUID PRIMARY KEY,
                        source_type VARCHAR(32) NOT NULL,
                        external_id VARCHAR(128) NOT NULL,
                        name VARCHAR(120) NOT NULL,
                        group_name VARCHAR(120),
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
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                    DROP TABLE IF EXISTS iam_user_roles;
                    DROP TABLE IF EXISTS iam_roles;
                    "#,
                )
                .await?;
            Ok(())
        }
    }
}

mod m20260714_000012_create_identity_user_tables {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
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
                    "#,
                )
                .await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                    DROP TABLE IF EXISTS iam_organization_memberships;
                    DROP TABLE IF EXISTS iam_external_identities;
                    DROP TABLE IF EXISTS iam_users;
                    "#,
                )
                .await?;
            Ok(())
        }
    }
}

mod m20260714_000011_create_identity_organization_tables {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
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
                    "#,
                )
                .await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS organization_units;")
                .await?;
            Ok(())
        }
    }
}

mod m20260713_000010_create_agent_mvp_tables {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
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

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                    DROP TABLE IF EXISTS agent_run_steps;
                    DROP TABLE IF EXISTS agent_runs;
                    DROP TABLE IF EXISTS agent_messages;
                    DROP TABLE IF EXISTS agent_sessions;
                    "#,
                )
                .await?;
            Ok(())
        }
    }
}

mod m20260626_000001_create_apps_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .create_table(
                    Table::create()
                        .table(Apps::Table)
                        .if_not_exists()
                        .col(ColumnDef::new(Apps::Id).uuid().not_null().primary_key())
                        .col(
                            ColumnDef::new(Apps::RouteAppId)
                                .string_len(32)
                                .not_null()
                                .unique_key(),
                        )
                        .col(ColumnDef::new(Apps::Name).string_len(120).not_null())
                        .col(ColumnDef::new(Apps::Description).string_len(255).not_null())
                        .col(ColumnDef::new(Apps::Icon).string_len(32).not_null())
                        .col(ColumnDef::new(Apps::Badge).string_len(32).null())
                        .col(ColumnDef::new(Apps::Color).string_len(96).not_null())
                        .col(ColumnDef::new(Apps::Status).string_len(24).not_null())
                        .col(ColumnDef::new(Apps::OwnerName).string_len(80).not_null())
                        .col(
                            ColumnDef::new(Apps::RecordsCount)
                                .big_integer()
                                .not_null()
                                .default(0),
                        )
                        .col(
                            ColumnDef::new(Apps::CreatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(Apps::UpdatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-apps-created-at")
                        .table(Apps::Table)
                        .col(Apps::CreatedAt)
                        .to_owned(),
                )
                .await
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .drop_table(Table::drop().table(Apps::Table).to_owned())
                .await
        }
    }

    #[derive(DeriveIden)]
    enum Apps {
        Table,
        Id,
        RouteAppId,
        Name,
        Description,
        Icon,
        Badge,
        Color,
        Status,
        OwnerName,
        RecordsCount,
        CreatedAt,
        UpdatedAt,
    }
}

mod m20260626_000002_create_form_definitions_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .create_table(
                    Table::create()
                        .table(FormDefinitions::Table)
                        .if_not_exists()
                        .col(
                            ColumnDef::new(FormDefinitions::Id)
                                .uuid()
                                .not_null()
                                .primary_key(),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::AppRouteAppId)
                                .string_len(32)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::FormUuid)
                                .string_len(40)
                                .not_null()
                                .unique_key(),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::Name)
                                .string_len(120)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::Slug)
                                .string_len(80)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::Status)
                                .string_len(24)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::DraftSchemaVersion)
                                .integer()
                                .not_null()
                                .default(1),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::PublishedSchemaVersion)
                                .integer()
                                .not_null()
                                .default(1),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::LatestSchemaVersion)
                                .integer()
                                .not_null()
                                .default(1),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::CreatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormDefinitions::UpdatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-form-definitions-app-route-app-id")
                        .table(FormDefinitions::Table)
                        .col(FormDefinitions::AppRouteAppId)
                        .to_owned(),
                )
                .await
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .drop_table(Table::drop().table(FormDefinitions::Table).to_owned())
                .await
        }
    }

    #[derive(DeriveIden)]
    enum FormDefinitions {
        Table,
        Id,
        AppRouteAppId,
        FormUuid,
        Name,
        Slug,
        Status,
        DraftSchemaVersion,
        PublishedSchemaVersion,
        LatestSchemaVersion,
        CreatedAt,
        UpdatedAt,
    }
}

mod m20260626_000003_create_form_schemas_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .create_table(
                    Table::create()
                        .table(FormSchemas::Table)
                        .if_not_exists()
                        .col(
                            ColumnDef::new(FormSchemas::Id)
                                .uuid()
                                .not_null()
                                .primary_key(),
                        )
                        .col(
                            ColumnDef::new(FormSchemas::FormUuid)
                                .string_len(40)
                                .not_null(),
                        )
                        .col(ColumnDef::new(FormSchemas::Version).integer().not_null())
                        .col(
                            ColumnDef::new(FormSchemas::SchemaJson)
                                .json_binary()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormSchemas::ChangeLog)
                                .string_len(255)
                                .null(),
                        )
                        .col(
                            ColumnDef::new(FormSchemas::Published)
                                .boolean()
                                .not_null()
                                .default(false),
                        )
                        .col(
                            ColumnDef::new(FormSchemas::CreatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormSchemas::UpdatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-form-schemas-form-uuid-version")
                        .table(FormSchemas::Table)
                        .col(FormSchemas::FormUuid)
                        .col(FormSchemas::Version)
                        .unique()
                        .to_owned(),
                )
                .await
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .drop_table(Table::drop().table(FormSchemas::Table).to_owned())
                .await
        }
    }

    #[derive(DeriveIden)]
    enum FormSchemas {
        Table,
        Id,
        FormUuid,
        Version,
        SchemaJson,
        ChangeLog,
        Published,
        CreatedAt,
        UpdatedAt,
    }
}

mod m20260626_000004_create_app_navigation_items_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .create_table(
                    Table::create()
                        .table(AppNavigationItems::Table)
                        .if_not_exists()
                        .col(
                            ColumnDef::new(AppNavigationItems::Id)
                                .uuid()
                                .not_null()
                                .primary_key(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::AppRouteAppId)
                                .string_len(32)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::ItemType)
                                .string_len(24)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::TargetFormUuid)
                                .string_len(40)
                                .null(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::Title)
                                .string_len(120)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::PathSlug)
                                .string_len(80)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::SortOrder)
                                .integer()
                                .not_null()
                                .default(0),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::IsDefaultEntry)
                                .boolean()
                                .not_null()
                                .default(false),
                        )
                        .col(ColumnDef::new(AppNavigationItems::ParentId).uuid().null())
                        .col(
                            ColumnDef::new(AppNavigationItems::VisibilityRule)
                                .string_len(255)
                                .null(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::CreatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AppNavigationItems::UpdatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-app-navigation-items-app-route-app-id")
                        .table(AppNavigationItems::Table)
                        .col(AppNavigationItems::AppRouteAppId)
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-app-navigation-items-default-entry")
                        .table(AppNavigationItems::Table)
                        .col(AppNavigationItems::AppRouteAppId)
                        .col(AppNavigationItems::IsDefaultEntry)
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("uidx-app-navigation-items-target-form-uuid")
                        .table(AppNavigationItems::Table)
                        .col(AppNavigationItems::TargetFormUuid)
                        .unique()
                        .to_owned(),
                )
                .await
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .drop_table(Table::drop().table(AppNavigationItems::Table).to_owned())
                .await
        }
    }

    #[derive(DeriveIden)]
    enum AppNavigationItems {
        Table,
        Id,
        AppRouteAppId,
        ItemType,
        TargetFormUuid,
        Title,
        PathSlug,
        SortOrder,
        IsDefaultEntry,
        ParentId,
        VisibilityRule,
        CreatedAt,
        UpdatedAt,
    }
}

mod m20260626_000005_create_form_records_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .create_table(
                    Table::create()
                        .table(FormRecords::Table)
                        .if_not_exists()
                        .col(
                            ColumnDef::new(FormRecords::Id)
                                .uuid()
                                .not_null()
                                .primary_key(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::RecordUuid)
                                .string_len(40)
                                .not_null()
                                .unique_key(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::AppRouteAppId)
                                .string_len(32)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::FormUuid)
                                .string_len(40)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::SchemaVersion)
                                .integer()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::RecordData)
                                .json_binary()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::CreatedBy)
                                .string_len(80)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::UpdatedBy)
                                .string_len(80)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::CreatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(FormRecords::UpdatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-form-records-form-uuid-created-at")
                        .table(FormRecords::Table)
                        .col(FormRecords::FormUuid)
                        .col(FormRecords::CreatedAt)
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-form-records-app-route-app-id")
                        .table(FormRecords::Table)
                        .col(FormRecords::AppRouteAppId)
                        .to_owned(),
                )
                .await
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .drop_table(Table::drop().table(FormRecords::Table).to_owned())
                .await
        }
    }

    #[derive(DeriveIden)]
    enum FormRecords {
        Table,
        Id,
        RecordUuid,
        AppRouteAppId,
        FormUuid,
        SchemaVersion,
        RecordData,
        CreatedBy,
        UpdatedBy,
        CreatedAt,
        UpdatedAt,
    }
}

mod m20260629_000006_create_automation_flows_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .create_table(
                    Table::create()
                        .table(AutomationFlows::Table)
                        .if_not_exists()
                        .col(
                            ColumnDef::new(AutomationFlows::Id)
                                .uuid()
                                .not_null()
                                .primary_key(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::FlowUuid)
                                .string_len(40)
                                .not_null()
                                .unique_key(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::AppRouteAppId)
                                .string_len(32)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::Name)
                                .string_len(120)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::Description)
                                .string_len(255)
                                .null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::Status)
                                .string_len(24)
                                .not_null()
                                .default("draft"),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::CurrentVersion)
                                .integer()
                                .not_null()
                                .default(1),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::TriggerFormUuid)
                                .string_len(40)
                                .null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::TriggerEvent)
                                .string_len(32)
                                .not_null()
                                .default("after_create"),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::TriggerConfig)
                                .json_binary()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::NodesJson)
                                .json_binary()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::EdgesJson)
                                .json_binary()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::CreatedBy)
                                .string_len(80)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::UpdatedBy)
                                .string_len(80)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::CreatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlows::UpdatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-automation-flows-app-route-app-id")
                        .table(AutomationFlows::Table)
                        .col(AutomationFlows::AppRouteAppId)
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-automation-flows-trigger-form-event")
                        .table(AutomationFlows::Table)
                        .col(AutomationFlows::TriggerFormUuid)
                        .col(AutomationFlows::TriggerEvent)
                        .to_owned(),
                )
                .await
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .drop_table(Table::drop().table(AutomationFlows::Table).to_owned())
                .await
        }
    }

    #[derive(DeriveIden)]
    enum AutomationFlows {
        Table,
        Id,
        FlowUuid,
        AppRouteAppId,
        Name,
        Description,
        Status,
        CurrentVersion,
        TriggerFormUuid,
        TriggerEvent,
        TriggerConfig,
        NodesJson,
        EdgesJson,
        CreatedBy,
        UpdatedBy,
        CreatedAt,
        UpdatedAt,
    }
}

mod m20260629_000007_add_automation_flow_versions {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .create_table(
                    Table::create()
                        .table(AutomationFlowVersions::Table)
                        .if_not_exists()
                        .col(
                            ColumnDef::new(AutomationFlowVersions::Id)
                                .uuid()
                                .not_null()
                                .primary_key(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlowVersions::FlowId)
                                .uuid()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlowVersions::Version)
                                .integer()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlowVersions::Name)
                                .string_len(120)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlowVersions::Description)
                                .string_len(255)
                                .null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlowVersions::Status)
                                .string_len(24)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlowVersions::TriggerFormUuid)
                                .string_len(40)
                                .null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlowVersions::TriggerEvent)
                                .string_len(32)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlowVersions::TriggerConfig)
                                .json_binary()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlowVersions::NodesJson)
                                .json_binary()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlowVersions::EdgesJson)
                                .json_binary()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlowVersions::ChangeSummary)
                                .string_len(255)
                                .null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlowVersions::CreatedBy)
                                .string_len(80)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationFlowVersions::CreatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-automation-flow-versions-flow-id-version")
                        .table(AutomationFlowVersions::Table)
                        .col(AutomationFlowVersions::FlowId)
                        .col(AutomationFlowVersions::Version)
                        .unique()
                        .to_owned(),
                )
                .await
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .drop_table(
                    Table::drop()
                        .table(AutomationFlowVersions::Table)
                        .to_owned(),
                )
                .await
        }
    }

    #[derive(DeriveIden)]
    enum AutomationFlowVersions {
        Table,
        Id,
        FlowId,
        Version,
        Name,
        Description,
        Status,
        TriggerFormUuid,
        TriggerEvent,
        TriggerConfig,
        NodesJson,
        EdgesJson,
        ChangeSummary,
        CreatedBy,
        CreatedAt,
    }
}

mod m20260629_000008_create_automation_nodes_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .create_table(
                    Table::create()
                        .table(AutomationNodes::Table)
                        .if_not_exists()
                        .col(
                            ColumnDef::new(AutomationNodes::Id)
                                .uuid()
                                .not_null()
                                .primary_key(),
                        )
                        .col(ColumnDef::new(AutomationNodes::FlowId).uuid().not_null())
                        .col(
                            ColumnDef::new(AutomationNodes::Version)
                                .integer()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationNodes::NodeKey)
                                .string_len(96)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationNodes::NodeKind)
                                .string_len(40)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationNodes::Label)
                                .string_len(120)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationNodes::Description)
                                .string_len(255)
                                .null(),
                        )
                        .col(
                            ColumnDef::new(AutomationNodes::PositionX)
                                .double()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationNodes::PositionY)
                                .double()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationNodes::ConfigJson)
                                .json_binary()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationNodes::RawJson)
                                .json_binary()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationNodes::CreatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationNodes::UpdatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-automation-nodes-flow-id-version-node-key")
                        .table(AutomationNodes::Table)
                        .col(AutomationNodes::FlowId)
                        .col(AutomationNodes::Version)
                        .col(AutomationNodes::NodeKey)
                        .unique()
                        .to_owned(),
                )
                .await
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .drop_table(Table::drop().table(AutomationNodes::Table).to_owned())
                .await
        }
    }

    #[derive(DeriveIden)]
    enum AutomationNodes {
        Table,
        Id,
        FlowId,
        Version,
        NodeKey,
        NodeKind,
        Label,
        Description,
        PositionX,
        PositionY,
        ConfigJson,
        RawJson,
        CreatedAt,
        UpdatedAt,
    }
}

mod m20260629_000009_create_automation_edges_table {
    use sea_orm_migration::prelude::*;

    #[derive(DeriveMigrationName)]
    pub struct Migration;

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .create_table(
                    Table::create()
                        .table(AutomationEdges::Table)
                        .if_not_exists()
                        .col(
                            ColumnDef::new(AutomationEdges::Id)
                                .uuid()
                                .not_null()
                                .primary_key(),
                        )
                        .col(ColumnDef::new(AutomationEdges::FlowId).uuid().not_null())
                        .col(
                            ColumnDef::new(AutomationEdges::Version)
                                .integer()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationEdges::EdgeKey)
                                .string_len(96)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationEdges::SourceNodeKey)
                                .string_len(96)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationEdges::TargetNodeKey)
                                .string_len(96)
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationEdges::SourceHandle)
                                .string_len(96)
                                .null(),
                        )
                        .col(
                            ColumnDef::new(AutomationEdges::TargetHandle)
                                .string_len(96)
                                .null(),
                        )
                        .col(
                            ColumnDef::new(AutomationEdges::RawJson)
                                .json_binary()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationEdges::CreatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .col(
                            ColumnDef::new(AutomationEdges::UpdatedAt)
                                .timestamp_with_time_zone()
                                .not_null(),
                        )
                        .to_owned(),
                )
                .await?;

            manager
                .create_index(
                    Index::create()
                        .name("idx-automation-edges-flow-id-version-edge-key")
                        .table(AutomationEdges::Table)
                        .col(AutomationEdges::FlowId)
                        .col(AutomationEdges::Version)
                        .col(AutomationEdges::EdgeKey)
                        .unique()
                        .to_owned(),
                )
                .await
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .drop_table(Table::drop().table(AutomationEdges::Table).to_owned())
                .await
        }
    }

    #[derive(DeriveIden)]
    enum AutomationEdges {
        Table,
        Id,
        FlowId,
        Version,
        EdgeKey,
        SourceNodeKey,
        TargetNodeKey,
        SourceHandle,
        TargetHandle,
        RawJson,
        CreatedAt,
        UpdatedAt,
    }
}
