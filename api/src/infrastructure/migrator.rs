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
            Box::new(m20260727_000032_add_agent_session_owner::Migration),
            Box::new(m20260727_000033_create_agent_transactions::Migration),
            Box::new(m20260727_000034_create_workflow_comments::Migration),
            Box::new(m20260727_000035_create_workflow_notifications::Migration),
            Box::new(m20260727_000036_add_workflow_pause_fields::Migration),
            Box::new(m20260728_000037_repair_agent_transactions::Migration),
            Box::new(m20260731_000038_create_agent_configuration_tables::Migration),
            Box::new(m20260731_000039_create_agent_resources_table::Migration),
            Box::new(m20260731_000040_add_agent_provider_website_url::Migration),
            Box::new(m20260731_000041_create_role_permissions::Migration),
            Box::new(m20260731_000042_create_platform_agent_assistant_settings::Migration),
            Box::new(m20260731_000043_create_platform_logs::Migration),
            Box::new(m20260803_000044_create_recycle_bin_entries::Migration),
            Box::new(m20260807_000045_drop_platform_agent_assistant_settings::Migration),
            Box::new(m20260807_000046_add_default_agent_model_provider::Migration),
            Box::new(m20260807_000047_drop_default_agent_session_id::Migration),
            Box::new(m20260819_000048_create_byom_model_routes::Migration),
            Box::new(m20260824_000049_scope_byom_model_routes::Migration),
            Box::new(m20260828_000050_add_app_creator_user_id::Migration),
            Box::new(m20260831_000051_add_app_market_fields::Migration),
            Box::new(m20260901_000052_remove_form_publish_state::Migration),
            Box::new(m20260902_000053_add_agent_session_archived_at::Migration),
            Box::new(m20260902_000054_create_agent_files::Migration),
            Box::new(m20260902_000055_remove_legacy_schema_analysis::Migration),
            Box::new(m20260903_000056_remove_app_status::Migration),
            Box::new(m20260904_000057_drop_agent_transactions::Migration),
            Box::new(m20260904_000057_repair_form_current_schema_version::Migration),
            Box::new(m20260904_000058_remove_legacy_agent_pending_actions::Migration),
            Box::new(m20260916_000059_allow_duplicate_agent_resource_names::Migration),
            Box::new(m20260918_000060_add_market_installations::Migration),
            Box::new(m20260918_000061_add_market_installation_lifecycle::Migration),
            Box::new(m20260918_000062_create_agent_session_runtime_summaries::Migration),
            Box::new(m20260918_000063_add_agent_session_lineage::Migration),
            Box::new(m20260918_000064_reset_legacy_agent_runtime::Migration),
            // These retired migration identities remain registered so installations
            // which applied the former YaYa knowledge system can start and advance
            // to the cleanup migration below.
            Box::new(m20260922_000065_create_knowledge_rag_tables::Migration),
            Box::new(m20260922_000066_extend_knowledge_rag_metadata::Migration),
            Box::new(m20260928_000067_create_agent_knowledge_bindings::Migration),
            Box::new(m20260928_000068_drop_legacy_agent_registry::Migration),
            Box::new(m20260928_000069_drop_yaya_knowledge_system::Migration),
            Box::new(m20260929_000070_create_im_reliable_mailbox::Migration),
            Box::new(m20260929_000071_migrate_to_im_authoritative_storage::Migration),
            Box::new(m20260930_000072_remove_automation_draft::Migration),
            Box::new(m20261006_000073_workflow_parallel_branches::Migration),
            Box::new(m20261006_000074_unified_automation_engine::Migration),
            Box::new(m20261007_000075_remove_automation_compatibility::Migration),
            Box::new(m20261008_000076_repair_workflow_comments_author::Migration),
            Box::new(m20261008_000077_cleanup_orphan_form_references::Migration),
            Box::new(m20261008_000078_remove_retired_field_config::Migration),
            Box::new(m20261012_000079_common_execution::Migration),
            Box::new(m20261012_000080_custom_buttons::Migration),
            Box::new(m20261013_000081_custom_button_scope::Migration),
            Box::new(m20261014_000082_user_smtp_authorizations::Migration),
            Box::new(m20261014_000083_additional_smtp_authorizations::Migration),
            Box::new(m20261013_000082_custom_button_fill_scope::Migration),
            Box::new(m20261013_000083_custom_button_open_page::Migration),
            Box::new(m20261019_000086_button_automation::Migration),
            Box::new(m20261021_000087_form_owned_custom_buttons::Migration),
            Box::new(m20261021_000088_button_conditions_owned_by_definition::Migration),
        ]
    }
}

mod m20261021_000088_button_conditions_owned_by_definition {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261021_000088_button_conditions_owned_by_definition"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(include_str!(
                    "../modules/custom_buttons/definition_conditions.sql"
                ))
                .await?;
            Ok(())
        }
        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20261021_000087_form_owned_custom_buttons {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261021_000087_form_owned_custom_buttons"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(include_str!("../modules/custom_buttons/form_ownership.sql"))
                .await?;
            Ok(())
        }
        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20261013_000083_custom_button_open_page {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261013_000083_custom_button_open_page"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("ALTER TABLE app_custom_buttons DROP CONSTRAINT IF EXISTS app_custom_buttons_action_type_check; ALTER TABLE app_custom_buttons ADD CONSTRAINT app_custom_buttons_action_type_check CHECK (action_type IN ('fill_form','open_page'));").await?;
            Ok(())
        }
        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20261013_000082_custom_button_fill_scope {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261013_000082_custom_button_fill_scope"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("ALTER TABLE app_custom_buttons ADD COLUMN IF NOT EXISTS fill_scope VARCHAR(16) NOT NULL DEFAULT 'other';").await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "ALTER TABLE app_custom_buttons DROP COLUMN IF EXISTS fill_scope;",
                )
                .await?;
            Ok(())
        }
    }
}

mod m20261013_000081_custom_button_scope {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261013_000081_custom_button_scope"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("ALTER TABLE app_custom_buttons ADD COLUMN IF NOT EXISTS button_scope VARCHAR(16) NOT NULL DEFAULT 'public'; ALTER TABLE app_custom_buttons ADD COLUMN IF NOT EXISTS scope_form_uuid VARCHAR(80); ALTER TABLE app_custom_buttons ADD COLUMN IF NOT EXISTS fill_scope VARCHAR(16) NOT NULL DEFAULT 'other'; UPDATE app_custom_buttons SET button_scope='public' WHERE button_scope IS NULL;").await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("ALTER TABLE app_custom_buttons DROP COLUMN IF EXISTS fill_scope; ALTER TABLE app_custom_buttons DROP COLUMN IF EXISTS scope_form_uuid; ALTER TABLE app_custom_buttons DROP COLUMN IF EXISTS button_scope;").await?;
            Ok(())
        }
    }
}

mod m20261008_000076_repair_workflow_comments_author {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261008_000076_repair_workflow_comments_author"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "ALTER TABLE workflow_comments ADD COLUMN IF NOT EXISTS author_user_id UUID REFERENCES iam_users(id) ON DELETE RESTRICT;",
                )
                .await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "ALTER TABLE workflow_comments DROP COLUMN IF EXISTS author_user_id;",
                )
                .await?;
            Ok(())
        }
    }
}

mod m20261008_000077_cleanup_orphan_form_references {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261008_000077_cleanup_orphan_form_references"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                    DELETE FROM app_navigation_items AS navigation
                    WHERE navigation.target_form_uuid IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1
                          FROM form_definitions AS form
                          WHERE form.form_uuid = navigation.target_form_uuid
                      );

                    DELETE FROM form_detail_definitions AS detail
                    WHERE NOT EXISTS (
                              SELECT 1
                              FROM form_definitions AS source_form
                              WHERE source_form.form_uuid = detail.source_form_uuid
                          )
                       OR NOT EXISTS (
                              SELECT 1
                              FROM form_definitions AS detail_form
                              WHERE detail_form.form_uuid = detail.detail_form_uuid
                          );
                    "#,
                )
                .await?;
            Ok(())
        }

        async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260930_000072_remove_automation_draft {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260930_000072_remove_automation_draft"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
                UPDATE automation_flows SET status = 'paused' WHERE status IN ('draft', 'disabled');
                UPDATE automation_flow_versions SET status = 'paused' WHERE status IN ('draft', 'disabled');
                ALTER TABLE automation_flows ALTER COLUMN status SET DEFAULT 'paused';
            "#).await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "ALTER TABLE automation_flows ALTER COLUMN status SET DEFAULT 'draft'",
                )
                .await?;
            Ok(())
        }
    }
}

mod m20260929_000071_migrate_to_im_authoritative_storage {
    use sea_orm_migration::prelude::*;

    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260929_000071_migrate_to_im_authoritative_storage"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
                CREATE EXTENSION IF NOT EXISTS pgcrypto;
                -- Refuse to destructively migrate a legacy installation whose schema
                -- does not match the source layout we know how to copy.
                DO $$ DECLARE missing TEXT; BEGIN
                    IF to_regclass('public.communication_conversations') IS NOT NULL THEN
                        SELECT string_agg(x.name, ',') INTO missing FROM (VALUES
                          ('id'),('conversation_uuid'),('conversation_type'),('direct_key'),('title'),
                          ('created_by_user_id'),('last_message_sequence'),('last_message_at'),('created_at'),('updated_at')
                        ) x(name) WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='communication_conversations' AND c.column_name=x.name);
                        IF missing IS NOT NULL THEN RAISE EXCEPTION 'IM migration legacy conversation columns missing: %', missing; END IF;
                    END IF;
                    IF to_regclass('public.communication_conversation_members') IS NOT NULL THEN
                        SELECT string_agg(x.name, ',') INTO missing FROM (VALUES
                          ('conversation_id'),('user_id'),('member_role'),('last_read_sequence'),('joined_at')
                        ) x(name) WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='communication_conversation_members' AND c.column_name=x.name);
                        IF missing IS NOT NULL THEN RAISE EXCEPTION 'IM migration legacy member columns missing: %', missing; END IF;
                    END IF;
                    IF to_regclass('public.communication_messages') IS NOT NULL THEN
                        SELECT string_agg(x.name, ',') INTO missing FROM (VALUES
                          ('id'),('message_uuid'),('conversation_id'),('sender_user_id'),('sequence'),('client_message_id'),
                          ('message_type'),('content'),('metadata_json'),('status'),('recalled_at'),('recalled_by_user_id'),
                          ('replaces_message_id'),('created_at'),('updated_at')
                        ) x(name) WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='communication_messages' AND c.column_name=x.name);
                        IF missing IS NOT NULL THEN RAISE EXCEPTION 'IM migration legacy message columns missing: %', missing; END IF;
                    END IF;
                    IF to_regclass('public.communication_message_attachments') IS NOT NULL THEN
                        SELECT string_agg(x.name, ',') INTO missing FROM (VALUES ('message_id'),('file_id'),('created_at')) x(name)
                        WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name='communication_message_attachments' AND c.column_name=x.name);
                        IF missing IS NOT NULL THEN RAISE EXCEPTION 'IM migration legacy attachment columns missing: %', missing; END IF;
                    END IF;
                    SELECT string_agg(format('%s:%s/%s', c.table_name,c.column_name,c.udt_name), ',') INTO missing
                    FROM information_schema.columns c
                    JOIN (VALUES
                      ('communication_conversations','id','uuid'),
                      ('communication_conversations','created_by_user_id','uuid'),
                      ('communication_conversations','last_message_sequence','int8'),
                      ('communication_conversation_members','conversation_id','uuid'),
                      ('communication_conversation_members','user_id','uuid'),
                      ('communication_conversation_members','last_read_sequence','int8'),
                      ('communication_messages','id','uuid'),
                      ('communication_messages','conversation_id','uuid'),
                      ('communication_messages','sender_user_id','uuid'),
                      ('communication_messages','sequence','int8'),
                      ('communication_message_attachments','message_id','uuid'),
                      ('communication_message_attachments','file_id','uuid')
                    ) expected(table_name,column_name,udt_name)
                      ON expected.table_name=c.table_name AND expected.column_name=c.column_name
                    WHERE c.table_schema='public' AND c.udt_name<>expected.udt_name;
                    IF missing IS NOT NULL THEN RAISE EXCEPTION 'IM migration legacy column types incompatible: %', missing; END IF;
                END $$;
                CREATE TABLE IF NOT EXISTS im_conversations (
                    id UUID PRIMARY KEY,
                    conversation_uuid VARCHAR(96) NOT NULL UNIQUE,
                    conversation_type VARCHAR(16) NOT NULL,
                    direct_key VARCHAR(80) UNIQUE,
                    title VARCHAR(160),
                    created_by_user_id UUID NOT NULL REFERENCES iam_users(id) ON DELETE RESTRICT,
                    last_message_sequence BIGINT NOT NULL DEFAULT 0,
                    last_message_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL
                );
                CREATE TABLE IF NOT EXISTS im_conversation_members (
                    conversation_id UUID NOT NULL REFERENCES im_conversations(id) ON DELETE CASCADE,
                    user_id UUID NOT NULL REFERENCES iam_users(id) ON DELETE CASCADE,
                    member_role VARCHAR(16) NOT NULL DEFAULT 'member',
                    last_read_sequence BIGINT NOT NULL DEFAULT 0,
                    joined_at TIMESTAMPTZ NOT NULL,
                    left_at TIMESTAMPTZ,
                    PRIMARY KEY(conversation_id,user_id)
                );
                CREATE INDEX IF NOT EXISTS idx_im_conversation_members_user ON im_conversation_members(user_id,conversation_id);
                CREATE TABLE IF NOT EXISTS im_messages (
                    id UUID PRIMARY KEY,
                    message_uuid VARCHAR(64) NOT NULL UNIQUE,
                    conversation_id UUID NOT NULL REFERENCES im_conversations(id) ON DELETE CASCADE,
                    sender_user_id UUID NOT NULL REFERENCES iam_users(id) ON DELETE RESTRICT,
                    conversation_seq BIGINT NOT NULL,
                    local_id VARCHAR(160),
                    message_type VARCHAR(24) NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    status VARCHAR(16) NOT NULL DEFAULT 'active',
                    recalled_at TIMESTAMPTZ,
                    recalled_by_user_id UUID REFERENCES iam_users(id) ON DELETE SET NULL,
                    replaces_message_id UUID REFERENCES im_messages(id) ON DELETE SET NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    UNIQUE(conversation_id,conversation_seq),
                    UNIQUE(sender_user_id,local_id)
                );
                CREATE INDEX IF NOT EXISTS idx_im_messages_conversation_seq ON im_messages(conversation_id,conversation_seq DESC);
                CREATE TABLE IF NOT EXISTS im_message_attachments (
                    message_id UUID NOT NULL REFERENCES im_messages(id) ON DELETE CASCADE,
                    file_id UUID NOT NULL REFERENCES uploaded_files(id) ON DELETE RESTRICT,
                    created_at TIMESTAMPTZ NOT NULL,
                    PRIMARY KEY(message_id,file_id)
                );
                CREATE INDEX IF NOT EXISTS idx_im_message_attachments_file ON im_message_attachments(file_id,message_id);
                CREATE TABLE IF NOT EXISTS im_business_message_bindings (
                    message_id UUID PRIMARY KEY REFERENCES im_messages(id) ON DELETE CASCADE,
                    business_type VARCHAR(32) NOT NULL,
                    business_id UUID NOT NULL,
                    card_type VARCHAR(64) NOT NULL,
                    action_schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    status VARCHAR(24) NOT NULL DEFAULT 'active',
                    expires_at TIMESTAMPTZ
                );

                DO $$ BEGIN
                    IF to_regclass('public.communication_conversations') IS NOT NULL THEN
                        INSERT INTO im_conversations(id,conversation_uuid,conversation_type,direct_key,title,created_by_user_id,last_message_sequence,last_message_at,created_at,updated_at)
                        SELECT cc.id,cc.conversation_uuid,cc.conversation_type,cc.direct_key,cc.title,cc.created_by_user_id,cc.last_message_sequence,cc.last_message_at,cc.created_at,cc.updated_at FROM communication_conversations cc
                        ON CONFLICT(id) DO NOTHING;
                    END IF;
                    IF to_regclass('public.communication_conversation_members') IS NOT NULL THEN
                        INSERT INTO im_conversation_members(conversation_id,user_id,member_role,last_read_sequence,joined_at)
                        SELECT conversation_id,user_id,member_role,last_read_sequence,joined_at FROM communication_conversation_members
                        ON CONFLICT(conversation_id,user_id) DO NOTHING;
                    END IF;
                    IF to_regclass('public.communication_messages') IS NOT NULL THEN
                        INSERT INTO im_messages(id,message_uuid,conversation_id,sender_user_id,conversation_seq,local_id,message_type,content,payload_json,status,recalled_at,recalled_by_user_id,replaces_message_id,created_at,updated_at)
                        SELECT cm.id,cm.message_uuid,cm.conversation_id,cm.sender_user_id,cm.sequence,cm.client_message_id,cm.message_type,cm.content,cm.metadata_json,cm.status,cm.recalled_at,cm.recalled_by_user_id,cm.replaces_message_id,cm.created_at,cm.updated_at FROM communication_messages cm
                        ON CONFLICT(id) DO NOTHING;
                    END IF;
                    IF to_regclass('public.communication_message_attachments') IS NOT NULL THEN
                        INSERT INTO im_message_attachments(message_id,file_id,created_at)
                        SELECT cma.message_id,cma.file_id,cma.created_at FROM communication_message_attachments cma
                        ON CONFLICT(message_id,file_id) DO NOTHING;
                    END IF;
                END $$;

                -- A private system conversation per user gives existing workflow notices
                -- normal conversation membership/read-cursor semantics.
                INSERT INTO im_conversations(id,conversation_uuid,conversation_type,title,created_by_user_id,last_message_sequence,created_at,updated_at)
                SELECT gen_random_uuid(),'system-'||u.id::text,'system','系统通知',u.id,0,NOW(),NOW()
                FROM iam_users u
                WHERE EXISTS (SELECT 1 FROM workflow_notifications n WHERE n.recipient_user_id=u.id)
                ON CONFLICT(conversation_uuid) DO NOTHING;
                INSERT INTO im_conversation_members(conversation_id,user_id,member_role,last_read_sequence,joined_at)
                SELECT c.id,u.id,'owner',0,NOW() FROM im_conversations c JOIN iam_users u ON c.conversation_uuid='system-'||u.id::text
                ON CONFLICT(conversation_id,user_id) DO NOTHING;

                WITH notices AS (
                    SELECT n.*, c.id AS conv_id,
                           t.task_uuid,
                           row_number() OVER(PARTITION BY n.recipient_user_id ORDER BY n.created_at,n.id) AS seq
                    FROM workflow_notifications n
                    JOIN im_conversations c ON c.conversation_uuid='system-'||n.recipient_user_id::text
                    LEFT JOIN workflow_tasks t ON t.id=n.task_id
                    WHERE n.recipient_user_id IS NOT NULL
                ), inserted AS (
                    INSERT INTO im_messages(id,message_uuid,conversation_id,sender_user_id,conversation_seq,local_id,message_type,content,payload_json,status,created_at,updated_at)
                    SELECT gen_random_uuid(),n.notification_uuid,n.conv_id,n.recipient_user_id,n.seq,n.id::text,'system',n.content,
                        jsonb_build_object('type','yaya.system_card','cardType',CASE WHEN n.task_id IS NULL THEN 'workflow' ELSE 'approval' END,'businessId',COALESCE(n.task_uuid,n.instance_id::text),'taskUuid',n.task_uuid,'version',1,'title',n.title,'content',n.content,'notificationType',n.notification_type,'formUuid',n.form_uuid,'recordUuid',n.record_uuid,'actions',CASE WHEN n.task_id IS NULL THEN '[]'::jsonb ELSE '[{"id":"approve","label":"同意"},{"id":"reject","label":"拒绝"}]'::jsonb END),
                        'active',n.created_at,n.created_at
                    FROM notices n ON CONFLICT(id) DO NOTHING RETURNING id,conversation_id,conversation_seq,sender_user_id,message_uuid,payload_json,created_at
                )
                INSERT INTO im_business_message_bindings(message_id,business_type,business_id,card_type,action_schema_json,status)
                SELECT i.id,CASE WHEN i.payload_json->>'cardType'='approval' THEN 'approval' ELSE 'workflow_notice' END,
                       COALESCE(n.task_id,n.instance_id),i.payload_json->>'cardType',i.payload_json->'actions','active'
                FROM inserted i JOIN workflow_notifications n ON n.notification_uuid=i.message_uuid
                ON CONFLICT(message_id) DO NOTHING;

                -- Rebuild deterministic mailbox history for migrated messages, grouped per recipient.
                WITH events AS (
                    SELECT m.id AS message_id,m.conversation_id,m.message_uuid,m.message_type,m.content,m.payload_json,m.conversation_seq,m.sender_user_id,m.created_at,cm.user_id,
                           row_number() OVER(PARTITION BY cm.user_id ORDER BY m.created_at,m.conversation_id,m.conversation_seq,m.id) AS mailbox_seq
                    FROM im_messages m JOIN im_conversation_members cm ON cm.conversation_id=m.conversation_id
                ), inserted_events AS (
                    INSERT INTO im_mailbox_events(id,user_id,mailbox_seq,conversation_id,message_id,event_type,payload_json,created_at)
                    SELECT gen_random_uuid(),e.user_id,e.mailbox_seq,e.conversation_id,e.message_id,'message.created',
                        jsonb_build_object('id',e.message_uuid,'messageId',e.message_uuid,'conversationId',c.conversation_uuid,'conversationSeq',e.conversation_seq,'sequence',e.conversation_seq,'senderUserId',e.sender_user_id::text,'messageType',e.message_type,'content',e.content,'status','active','localId',NULL,'createdAt',e.created_at),e.created_at
                    FROM events e JOIN im_conversations c ON c.id=e.conversation_id
                    ON CONFLICT(user_id,mailbox_seq) DO NOTHING
                    RETURNING id,user_id,mailbox_seq,event_type,payload_json,created_at
                )
                INSERT INTO im_delivery_outbox(id,event_id,event_type,payload_json,status,retry_count,next_retry_at,created_at)
                SELECT gen_random_uuid(),id,event_type,payload_json,'pending',0,NOW(),created_at FROM inserted_events;
                INSERT INTO im_mailbox_counters(user_id,next_seq,updated_at)
                SELECT user_id,MAX(mailbox_seq)+1,NOW() FROM im_mailbox_events GROUP BY user_id
                ON CONFLICT(user_id) DO UPDATE SET next_seq=GREATEST(im_mailbox_counters.next_seq,EXCLUDED.next_seq),updated_at=NOW();
                UPDATE im_conversations c SET last_message_sequence=x.max_seq,last_message_at=x.max_at,updated_at=NOW()
                FROM (SELECT conversation_id,MAX(conversation_seq) max_seq,MAX(created_at) max_at FROM im_messages GROUP BY conversation_id) x
                WHERE c.id=x.conversation_id AND c.conversation_type='system';

                DO $$ DECLARE old_messages BIGINT; new_messages BIGINT; old_members BIGINT; new_members BIGINT; old_attachments BIGINT; new_attachments BIGINT; bad_sequences BIGINT; bad_mailbox BIGINT; bad_bindings BIGINT;
                BEGIN
                    IF to_regclass('public.communication_messages') IS NOT NULL THEN
                        EXECUTE 'SELECT COUNT(*) FROM communication_messages' INTO old_messages;
                    SELECT COUNT(*) INTO new_messages FROM im_messages im WHERE im.id IN (SELECT cm.id FROM communication_messages cm);
                        IF old_messages <> new_messages THEN RAISE EXCEPTION 'IM migration message count mismatch: % vs %',old_messages,new_messages; END IF;
                    END IF;
                    IF to_regclass('public.communication_conversation_members') IS NOT NULL THEN
                        EXECUTE 'SELECT COUNT(*) FROM communication_conversation_members' INTO old_members;
                    SELECT COUNT(*) INTO new_members FROM im_conversation_members imcm WHERE (imcm.conversation_id,imcm.user_id) IN (SELECT cm.conversation_id,cm.user_id FROM communication_conversation_members cm);
                        IF old_members <> new_members THEN RAISE EXCEPTION 'IM migration member count mismatch: % vs %',old_members,new_members; END IF;
                    END IF;
                    IF to_regclass('public.communication_message_attachments') IS NOT NULL THEN
                        EXECUTE 'SELECT COUNT(*) FROM communication_message_attachments' INTO old_attachments;
                    SELECT COUNT(*) INTO new_attachments FROM im_message_attachments ima WHERE (ima.message_id,ima.file_id) IN (SELECT a.message_id,a.file_id FROM communication_message_attachments a);
                        IF old_attachments <> new_attachments THEN RAISE EXCEPTION 'IM migration attachment count mismatch: % vs %',old_attachments,new_attachments; END IF;
                    END IF;
                    SELECT COUNT(*) INTO bad_sequences FROM (SELECT conversation_id FROM im_messages GROUP BY conversation_id HAVING MIN(conversation_seq) <> 1 OR COUNT(*) <> MAX(conversation_seq)) q;
                    IF bad_sequences <> 0 THEN RAISE EXCEPTION 'IM migration conversation sequence gaps: %',bad_sequences; END IF;
                    SELECT COUNT(*) INTO bad_mailbox FROM (SELECT user_id FROM im_mailbox_events GROUP BY user_id HAVING MIN(mailbox_seq) <> 1 OR COUNT(*) <> MAX(mailbox_seq)) q;
                    IF bad_mailbox <> 0 THEN RAISE EXCEPTION 'IM migration mailbox sequence gaps: %',bad_mailbox; END IF;
                    SELECT COUNT(*) INTO bad_bindings FROM im_business_message_bindings b LEFT JOIN workflow_tasks t ON t.id=b.business_id WHERE b.business_type='approval' AND t.id IS NULL;
                    IF bad_bindings <> 0 THEN RAISE EXCEPTION 'IM migration orphan approval bindings: %',bad_bindings; END IF;
                END $$;
                DROP TABLE IF EXISTS communication_message_attachments;
                DROP TABLE IF EXISTS communication_messages;
                DROP TABLE IF EXISTS communication_conversation_members;
                DROP TABLE IF EXISTS communication_conversations;
            "#).await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("DROP TABLE IF EXISTS im_business_message_bindings; DROP TABLE IF EXISTS im_message_attachments; DROP TABLE IF EXISTS im_messages; DROP TABLE IF EXISTS im_conversation_members; DROP TABLE IF EXISTS im_conversations;").await?;
            Ok(())
        }
    }
}

mod m20260929_000070_create_im_reliable_mailbox {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260929_000070_create_im_reliable_mailbox"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
                CREATE TABLE IF NOT EXISTS im_mailbox_counters (
                    user_id UUID PRIMARY KEY,
                    next_seq BIGINT NOT NULL DEFAULT 1,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS im_mailbox_events (
                    id UUID PRIMARY KEY,
                    user_id UUID NOT NULL,
                    mailbox_seq BIGINT NOT NULL,
                    conversation_id UUID NULL,
                    message_id UUID NULL,
                    event_type VARCHAR(64) NOT NULL,
                    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL,
                    UNIQUE(user_id, mailbox_seq)
                );
                CREATE INDEX IF NOT EXISTS idx_im_mailbox_events_user_seq
                    ON im_mailbox_events(user_id, mailbox_seq);
                CREATE INDEX IF NOT EXISTS idx_im_mailbox_events_created
                    ON im_mailbox_events(created_at);
                CREATE INDEX IF NOT EXISTS idx_im_mailbox_events_retention
                    ON im_mailbox_events(created_at, user_id, mailbox_seq);
                CREATE TABLE IF NOT EXISTS im_device_cursors (
                    user_id UUID NOT NULL,
                    device_id VARCHAR(160) NOT NULL,
                    last_acked_mailbox_seq BIGINT NOT NULL DEFAULT 0,
                    last_seen_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    PRIMARY KEY(user_id, device_id)
                );
                CREATE TABLE IF NOT EXISTS im_delivery_outbox (
                    id UUID PRIMARY KEY,
                    event_id UUID NOT NULL,
                    event_type VARCHAR(64) NOT NULL,
                    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                    status VARCHAR(24) NOT NULL DEFAULT 'pending',
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    next_retry_at TIMESTAMPTZ NOT NULL,
                    last_error TEXT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    delivered_at TIMESTAMPTZ NULL
                );
                CREATE INDEX IF NOT EXISTS idx_im_delivery_outbox_pending
                    ON im_delivery_outbox(status, next_retry_at);
                ALTER TABLE im_delivery_outbox ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
            "#).await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(
                "DROP TABLE IF EXISTS im_delivery_outbox; DROP TABLE IF EXISTS im_device_cursors; DROP TABLE IF EXISTS im_mailbox_events; DROP TABLE IF EXISTS im_mailbox_counters;"
            ).await?;
            Ok(())
        }
    }
}

mod m20260928_000068_drop_legacy_agent_registry {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260928_000068_drop_legacy_agent_registry"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "DROP TABLE IF EXISTS agent_definitions CASCADE;
                 DROP TABLE IF EXISTS agent_config_profiles CASCADE;",
                )
                .await?;
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            // This early-stage cleanup intentionally does not restore retired data.
            Ok(())
        }
    }
}

mod m20260928_000069_drop_yaya_knowledge_system {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260928_000069_drop_yaya_knowledge_system"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "DROP TABLE IF EXISTS agent_knowledge_bindings;
                 DROP TABLE IF EXISTS knowledge_index_jobs;
                 DROP TABLE IF EXISTS knowledge_chunks;
                 DROP TABLE IF EXISTS knowledge_documents;
                 DELETE FROM agent_resources WHERE kind = 'knowledge_base';",
                )
                .await?;
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

// Historical migration identities for the retired YaYa-owned RAG system.
// Migration runners validate the complete applied history, so deleting these
// definitions prevents existing installations from starting. Their former
// schema work is deliberately a no-op for new installations; migration 69 is
// the single destructive cleanup for installations that still have those tables.
mod m20260922_000065_create_knowledge_rag_tables {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260922_000065_create_knowledge_rag_tables"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260922_000066_extend_knowledge_rag_metadata {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260922_000066_extend_knowledge_rag_metadata"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260928_000067_create_agent_knowledge_bindings {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260928_000067_create_agent_knowledge_bindings"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260918_000064_reset_legacy_agent_runtime {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260918_000064_reset_legacy_agent_runtime"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "
                CREATE TABLE IF NOT EXISTS agent_runtime_reset_markers (
                    version VARCHAR(80) PRIMARY KEY,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    workspace_cleanup_completed BOOLEAN NOT NULL DEFAULT FALSE
                );
                INSERT INTO agent_runtime_reset_markers (version)
                VALUES ('native-workbench-v1') ON CONFLICT (version) DO NOTHING;
                TRUNCATE TABLE agent_sessions CASCADE;
                DROP TABLE IF EXISTS agent_run_steps;
                DROP TABLE IF EXISTS agent_runs;
                DROP TABLE IF EXISTS agent_messages;
                ",
                )
                .await?;
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            // The native Workbench reset is intentionally irreversible.
            Ok(())
        }
    }
}

mod m20260918_000063_add_agent_session_lineage {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260918_000063_add_agent_session_lineage"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(
                "ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS parent_session_id UUID REFERENCES agent_sessions(id) ON DELETE SET NULL; CREATE INDEX IF NOT EXISTS idx_agent_sessions_parent ON agent_sessions (parent_session_id);",
            ).await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(
                "DROP INDEX IF EXISTS idx_agent_sessions_parent; ALTER TABLE agent_sessions DROP COLUMN IF EXISTS parent_session_id;",
            ).await?;
            Ok(())
        }
    }
}

mod m20260918_000062_create_agent_session_runtime_summaries {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260918_000062_create_agent_session_runtime_summaries"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "
                    CREATE TABLE IF NOT EXISTS agent_session_runtime_summaries (
                        session_id UUID PRIMARY KEY REFERENCES agent_sessions(id) ON DELETE CASCADE,
                        event_generation VARCHAR(120) NOT NULL DEFAULT 'initial',
                        last_event_seq BIGINT NOT NULL DEFAULT -1,
                        run_status VARCHAR(32) NOT NULL DEFAULT 'idle',
                        phase VARCHAR(40),
                        last_tool_name VARCHAR(255),
                        last_error TEXT,
                        pending_approval_count INTEGER NOT NULL DEFAULT 0,
                        unread_activity_version BIGINT NOT NULL DEFAULT 0,
                        last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CHECK (run_status IN ('idle', 'queued', 'running', 'waiting_approval', 'completed', 'stopped', 'failed', 'unknown'))
                    );
                    INSERT INTO agent_session_runtime_summaries (
                        session_id, last_activity_at, updated_at
                    )
                    SELECT id, COALESCE(updated_at, created_at), COALESCE(updated_at, created_at)
                    FROM agent_sessions
                    ON CONFLICT (session_id) DO NOTHING;
                    CREATE INDEX IF NOT EXISTS idx_agent_session_runtime_summaries_activity
                        ON agent_session_runtime_summaries (last_activity_at DESC, session_id);
                    CREATE INDEX IF NOT EXISTS idx_agent_session_runtime_summaries_status_activity
                        ON agent_session_runtime_summaries (run_status, last_activity_at DESC, session_id);
                    ",
                )
                .await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS agent_session_runtime_summaries;")
                .await?;
            Ok(())
        }
    }
}

mod m20260918_000061_add_market_installation_lifecycle {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260918_000061_add_market_installation_lifecycle"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("ALTER TABLE market_installations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ; ALTER TABLE market_installations ADD COLUMN IF NOT EXISTS legacy_mapping BOOLEAN NOT NULL DEFAULT FALSE; CREATE TABLE IF NOT EXISTS market_installation_versions (installation_id UUID NOT NULL, release_id VARCHAR(128) NOT NULL, version VARCHAR(64) NOT NULL, package_sha256 VARCHAR(128) NOT NULL, package_bytes BYTEA, snapshot_json JSONB NOT NULL DEFAULT '{}', applied_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(installation_id, release_id)); CREATE INDEX IF NOT EXISTS idx_market_installation_versions_applied ON market_installation_versions(installation_id, applied_at DESC);").await?;
            Ok(())
        }
        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260918_000060_add_market_installations {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260918_000060_add_market_installations"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("CREATE TABLE IF NOT EXISTS market_installations (installation_id UUID PRIMARY KEY, product_id VARCHAR(128) NOT NULL, release_id VARCHAR(128) NOT NULL, local_app_id VARCHAR(128) NOT NULL, status VARCHAR(32) NOT NULL, installed_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS idx_market_installation_product ON market_installations(product_id); CREATE TABLE IF NOT EXISTS market_installation_resources (installation_id UUID NOT NULL, resource_type VARCHAR(64) NOT NULL, source_id VARCHAR(128) NOT NULL, local_id VARCHAR(128) NOT NULL, PRIMARY KEY(installation_id, resource_type, source_id)); CREATE TABLE IF NOT EXISTS market_installation_events (id UUID PRIMARY KEY, installation_id UUID NOT NULL, event_type VARCHAR(64) NOT NULL, detail_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL);").await?;
            Ok(())
        }
        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260916_000059_allow_duplicate_agent_resource_names {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260916_000059_allow_duplicate_agent_resource_names"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            // Resource IDs are the stable references used by profiles and
            // agents. Names are display labels and may legitimately repeat
            // when a market package replaces a skill with a new ID.
            manager
                .get_connection()
                .execute_unprepared(
                    "ALTER TABLE agent_resources DROP CONSTRAINT IF EXISTS agent_resources_kind_name_key;",
                )
                .await?;
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260904_000057_drop_agent_transactions {
    use sea_orm_migration::prelude::*;
    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260904_000057_drop_agent_transactions"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS agent_transactions;")
                .await?;
            Ok(())
        }
        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260904_000058_remove_legacy_agent_pending_actions {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260904_000058_remove_legacy_agent_pending_actions"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                    DROP TABLE IF EXISTS agent_pending_actions;
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

mod m20260904_000057_repair_form_current_schema_version {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260904_000057_repair_form_current_schema_version"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            // m052/legacy bootstrap previously defaulted current to 1 before
            // dropping the old pointers. Reconcile both counters with the
            // newest schema row so reads and subsequent saves use the same version.
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                    WITH schema_versions AS (
                        SELECT
                            fd.form_uuid,
                            COALESCE(MAX(fs.version), 1)::INTEGER AS max_version
                        FROM form_definitions AS fd
                        LEFT JOIN form_schemas AS fs ON fs.form_uuid = fd.form_uuid
                        GROUP BY fd.form_uuid
                    )
                    UPDATE form_definitions AS fd
                    SET current_schema_version = schema_versions.max_version,
                        latest_schema_version = schema_versions.max_version
                    FROM schema_versions
                    WHERE fd.form_uuid = schema_versions.form_uuid;
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

mod m20260903_000056_remove_app_status {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260903_000056_remove_app_status"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("ALTER TABLE apps DROP COLUMN IF EXISTS status;")
                .await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "ALTER TABLE apps ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'enabled';",
                )
                .await?;
            Ok(())
        }
    }
}

mod m20260902_000055_remove_legacy_schema_analysis {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260902_000055_remove_legacy_schema_analysis"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            // Destructive cleanup for the pre-tool-based Schema analysis feature.
            // Keep pageProps.agent.enabled/agentId/prompt intact.
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                UPDATE form_schemas
                SET schema_json = schema_json #- '{pageProps,agent,context}'
                WHERE schema_json #>> '{pageProps,agent,context}' IS NOT NULL;
                DELETE FROM agent_sessions WHERE source = 'schema_analysis';
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

mod m20260901_000052_remove_form_publish_state {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260901_000052_remove_form_publish_state"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                    ALTER TABLE form_definitions
                        ADD COLUMN IF NOT EXISTS current_schema_version INTEGER NOT NULL DEFAULT 1;

                    UPDATE form_definitions
                    SET current_schema_version = GREATEST(COALESCE(current_schema_version, 1), 1);
                    ALTER TABLE form_definitions
                        ALTER COLUMN current_schema_version SET DEFAULT 1,
                        ALTER COLUMN current_schema_version SET NOT NULL;
                    ALTER TABLE form_definitions
                        DROP COLUMN IF EXISTS status,
                        DROP COLUMN IF EXISTS draft_schema_version,
                        DROP COLUMN IF EXISTS published_schema_version;
                    ALTER TABLE form_schemas DROP COLUMN IF EXISTS published;
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

mod m20260902_000053_add_agent_session_archived_at {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260902_000053_add_agent_session_archived_at"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(
                "ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ; CREATE INDEX IF NOT EXISTS idx_agent_sessions_archived_at ON agent_sessions (archived_at) WHERE status = 'archived';"
            ).await?;
            Ok(())
        }
        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260902_000054_create_agent_files {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260902_000054_create_agent_files"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
                CREATE TABLE IF NOT EXISTS agent_files (
                  id UUID PRIMARY KEY, session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
                  owner_user_id UUID NOT NULL REFERENCES iam_users(id) ON DELETE CASCADE, agent_id VARCHAR(80) NOT NULL,
                  original_name TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, mime_type VARCHAR(255) NOT NULL,
                  byte_size BIGINT NOT NULL, checksum VARCHAR(128) NOT NULL, kind VARCHAR(16) NOT NULL DEFAULT 'input',
                  created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ
                );
                CREATE INDEX IF NOT EXISTS idx_agent_files_session ON agent_files(session_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS agent_file_links (
                  id UUID PRIMARY KEY, file_id UUID NOT NULL REFERENCES agent_files(id) ON DELETE CASCADE,
                  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
                  message_seq BIGINT, run_id VARCHAR(128), role VARCHAR(32) NOT NULL, created_at TIMESTAMPTZ NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_agent_file_links_session ON agent_file_links(session_id, created_at DESC);
            "#).await?;
            Ok(())
        }
        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260831_000051_add_app_market_fields {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260831_000051_add_app_market_fields"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("ALTER TABLE apps ADD COLUMN IF NOT EXISTS deployment_type VARCHAR(32) NOT NULL DEFAULT 'local'; ALTER TABLE apps ADD COLUMN IF NOT EXISTS online_version VARCHAR(32); ALTER TABLE apps ADD COLUMN IF NOT EXISTS online_release_id VARCHAR(128);").await?;
            Ok(())
        }
        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260828_000050_add_app_creator_user_id {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260828_000050_add_app_creator_user_id"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "ALTER TABLE apps ADD COLUMN IF NOT EXISTS creator_user_id UUID;",
                )
                .await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("ALTER TABLE apps DROP COLUMN IF EXISTS creator_user_id;")
                .await?;
            Ok(())
        }
    }
}

mod m20260824_000049_scope_byom_model_routes {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260824_000049_scope_byom_model_routes"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
                ALTER TABLE byom_model_routes ADD COLUMN IF NOT EXISTS tenant_id UUID;
                ALTER TABLE byom_model_routes ADD COLUMN IF NOT EXISTS created_by_user_id UUID;
                DROP INDEX IF EXISTS uq_byom_model_routes_single_default;
                CREATE INDEX IF NOT EXISTS ix_byom_model_routes_tenant ON byom_model_routes (tenant_id, is_default);
                DELETE FROM byom_model_routes WHERE tenant_id IS NULL;
            "#).await?;
            Ok(())
        }
        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260819_000048_create_byom_model_routes {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260819_000048_create_byom_model_routes"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                CREATE TABLE IF NOT EXISTS byom_model_routes (
                    id VARCHAR(96) PRIMARY KEY,
                    name VARCHAR(160) NOT NULL,
                    api_base_url TEXT NOT NULL,
                    encrypted_api_key TEXT NOT NULL,
                    default_chat_model VARCHAR(256) NOT NULL,
                    models JSONB NOT NULL DEFAULT '[]'::jsonb,
                    enabled BOOLEAN NOT NULL DEFAULT TRUE,
                    is_default BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                CREATE UNIQUE INDEX IF NOT EXISTS uq_byom_model_routes_single_default
                    ON byom_model_routes (is_default) WHERE is_default = TRUE;
            "#,
                )
                .await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS byom_model_routes;")
                .await?;
            Ok(())
        }
    }
}

mod m20260807_000047_drop_default_agent_session_id {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260807_000047_drop_default_agent_session_id"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "ALTER TABLE agent_sessions ALTER COLUMN agent_id DROP DEFAULT;",
                )
                .await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "ALTER TABLE agent_sessions ALTER COLUMN agent_id SET DEFAULT 'agent-default';",
                )
                .await?;
            Ok(())
        }
    }
}

mod m20260807_000046_add_default_agent_model_provider {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260807_000046_add_default_agent_model_provider"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                ALTER TABLE agent_model_providers
                    ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
                CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_model_providers_single_default
                    ON agent_model_providers (is_default) WHERE is_default = TRUE;
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
                DROP INDEX IF EXISTS uq_agent_model_providers_single_default;
                ALTER TABLE agent_model_providers DROP COLUMN IF EXISTS is_default;
            "#,
                )
                .await?;
            Ok(())
        }
    }
}

mod m20260807_000045_drop_platform_agent_assistant_settings {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260807_000045_drop_platform_agent_assistant_settings"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS platform_agent_assistant_settings;")
                .await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
                CREATE TABLE IF NOT EXISTS platform_agent_assistant_settings (
                    id SMALLINT PRIMARY KEY CHECK (id = 1),
                    navigation_agent_id VARCHAR(96) REFERENCES agent_definitions(id) ON DELETE SET NULL,
                    schema_analysis_prompt TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            "#).await?;
            Ok(())
        }
    }
}

mod m20260803_000044_create_recycle_bin_entries {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260803_000044_create_recycle_bin_entries"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
                CREATE TABLE IF NOT EXISTS form_recycle_bin_entries (
                    id UUID PRIMARY KEY,
                    form_uuid VARCHAR(40) NOT NULL,
                    record_uuid VARCHAR(80) NOT NULL,
                    source_form_name VARCHAR(160) NOT NULL,
                    form_type VARCHAR(24) NOT NULL,
                    record_data JSONB NOT NULL,
                    deleted_at TIMESTAMPTZ NOT NULL,
                    detail_source_form_uuid VARCHAR(40) NULL,
                    detail_subform_field_id VARCHAR(120) NULL,
                    detail_row_index INTEGER NULL,
                    UNIQUE(form_uuid, record_uuid)
                );
                CREATE INDEX IF NOT EXISTS idx_form_recycle_bin_deleted_at ON form_recycle_bin_entries (deleted_at DESC);
                CREATE INDEX IF NOT EXISTS idx_form_recycle_bin_form_uuid ON form_recycle_bin_entries (form_uuid);
                DO $$ DECLARE item RECORD; BEGIN
                    FOR item IN SELECT physical_table FROM form_storage_definitions LOOP
                        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL', item.physical_table);
                    END LOOP;
                END $$;
            "#).await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS form_recycle_bin_entries;")
                .await?;
            Ok(())
        }
    }
}

mod m20260731_000043_create_platform_logs {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260731_000043_create_platform_logs"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
                CREATE TABLE IF NOT EXISTS platform_logs (
                    id UUID PRIMARY KEY,
                    occurred_at TIMESTAMPTZ NOT NULL,
                    level VARCHAR(8) NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
                    target VARCHAR(255) NOT NULL,
                    message TEXT NOT NULL,
                    fields JSONB NOT NULL DEFAULT '{}'::jsonb
                );
                CREATE INDEX IF NOT EXISTS idx_platform_logs_occurred_at ON platform_logs (occurred_at DESC);
                CREATE INDEX IF NOT EXISTS idx_platform_logs_level_occurred_at ON platform_logs (level, occurred_at DESC);
            "#).await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS platform_logs;")
                .await?;
            Ok(())
        }
    }
}

mod m20260731_000042_create_platform_agent_assistant_settings {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260731_000042_create_platform_agent_assistant_settings"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
                CREATE TABLE IF NOT EXISTS platform_agent_assistant_settings (
                    id SMALLINT PRIMARY KEY CHECK (id = 1),
                    navigation_agent_id VARCHAR(96) REFERENCES agent_definitions(id) ON DELETE SET NULL,
                    schema_analysis_prompt TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            "#).await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS platform_agent_assistant_settings;")
                .await?;
            Ok(())
        }
    }
}

mod m20260731_000041_create_role_permissions {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260731_000041_create_role_permissions"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                CREATE TABLE IF NOT EXISTS iam_role_permissions (
                    id UUID PRIMARY KEY,
                    role_id UUID NOT NULL REFERENCES iam_roles(id) ON DELETE CASCADE,
                    permission VARCHAR(255) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    UNIQUE (role_id, permission)
                );
                CREATE INDEX IF NOT EXISTS idx_iam_role_permissions_role_id
                    ON iam_role_permissions(role_id);
            "#,
                )
                .await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS iam_role_permissions;")
                .await?;
            Ok(())
        }
    }
}

mod m20260731_000039_create_agent_resources_table {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260731_000039_create_agent_resources_table"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                CREATE TABLE IF NOT EXISTS agent_resources (
                    id VARCHAR(96) PRIMARY KEY,
                    kind VARCHAR(32) NOT NULL,
                    name VARCHAR(160) NOT NULL,
                    configuration_json JSONB NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS idx_agent_resources_kind ON agent_resources(kind);
            "#,
                )
                .await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS agent_resources;")
                .await?;
            Ok(())
        }
    }
}

mod m20260731_000040_add_agent_provider_website_url {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260731_000040_add_agent_provider_website_url"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(
                "ALTER TABLE agent_model_providers ADD COLUMN IF NOT EXISTS website_url TEXT NOT NULL DEFAULT '';",
            ).await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    "ALTER TABLE agent_model_providers DROP COLUMN IF EXISTS website_url;",
                )
                .await?;
            Ok(())
        }
    }
}

mod m20260731_000038_create_agent_configuration_tables {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260731_000038_create_agent_configuration_tables"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
                CREATE TABLE IF NOT EXISTS agent_model_providers (
                    id VARCHAR(96) PRIMARY KEY, name VARCHAR(160) NOT NULL, kind VARCHAR(80) NOT NULL,
                    enabled BOOLEAN NOT NULL, api_base_url TEXT NOT NULL, api_key TEXT NOT NULL DEFAULT '', website_url TEXT NOT NULL DEFAULT '',
                    default_chat_model VARCHAR(200) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                CREATE TABLE IF NOT EXISTS agent_provider_models (
                    id UUID PRIMARY KEY, provider_id VARCHAR(96) NOT NULL REFERENCES agent_model_providers(id) ON DELETE CASCADE,
                    model_id VARCHAR(200) NOT NULL, capability VARCHAR(40) NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
                    is_default BOOLEAN NOT NULL DEFAULT FALSE, UNIQUE(provider_id, model_id, capability)
                );
                CREATE TABLE IF NOT EXISTS agent_config_profiles (
                    id VARCHAR(96) PRIMARY KEY, name VARCHAR(160) NOT NULL,
                    provider_id VARCHAR(96) NOT NULL REFERENCES agent_model_providers(id) ON DELETE RESTRICT,
                    configuration_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                CREATE TABLE IF NOT EXISTS agent_definitions (
                    id VARCHAR(96) PRIMARY KEY, name VARCHAR(160) NOT NULL, enabled BOOLEAN NOT NULL,
                    is_default BOOLEAN NOT NULL DEFAULT FALSE, scope_type VARCHAR(40) NOT NULL, scope_ref_id VARCHAR(120),
                    profile_id VARCHAR(96) NOT NULL REFERENCES agent_config_profiles(id) ON DELETE RESTRICT,
                    configuration_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS idx_agent_profiles_provider ON agent_config_profiles(provider_id);
                CREATE INDEX IF NOT EXISTS idx_agent_definitions_profile ON agent_definitions(profile_id);
                CREATE INDEX IF NOT EXISTS idx_agent_definitions_scope ON agent_definitions(scope_type, scope_ref_id);
            "#).await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("DROP TABLE IF EXISTS agent_definitions; DROP TABLE IF EXISTS agent_config_profiles; DROP TABLE IF EXISTS agent_provider_models; DROP TABLE IF EXISTS agent_model_providers;").await?;
            Ok(())
        }
    }
}

// The older migrations in this file all derive the file name ("migrator") as
// their migration name. New migrations must declare a unique name explicitly.
mod m20260728_000037_repair_agent_transactions {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            // Keep the historical migration identity so existing databases do
            // not fail startup after the table was renamed to transactions.
            "m20260728_000037_repair_agent_pending_actions"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                    DO $$
                    BEGIN
                        IF to_regclass('agent_sessions') IS NOT NULL THEN
                            CREATE TABLE IF NOT EXISTS agent_transactions (
                                id UUID PRIMARY KEY,
                                action_uuid VARCHAR(64) NOT NULL UNIQUE,
                                session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
                                action_type VARCHAR(64) NOT NULL,
                                payload_json JSONB NOT NULL,
                                summary TEXT NOT NULL,
                                status VARCHAR(24) NOT NULL,
                                expires_at TIMESTAMPTZ NOT NULL,
                                confirmed_at TIMESTAMPTZ,
                                error_message TEXT,
                                created_at TIMESTAMPTZ NOT NULL,
                                completed_at TIMESTAMPTZ
                            );
                            CREATE INDEX IF NOT EXISTS idx_agent_transactions_session_status
                                ON agent_transactions (session_id, status, created_at DESC);
                        END IF;
                    END $$;
                    "#,
                )
                .await?;
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS agent_transactions;")
                .await?;
            Ok(())
        }
    }
}

mod m20260727_000036_add_workflow_pause_fields {
    use sea_orm_migration::prelude::*;
    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260727_000036_add_workflow_pause_fields"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS paused_by VARCHAR(120), ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS pause_reason TEXT;").await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("ALTER TABLE workflow_instances DROP COLUMN IF EXISTS paused_by, DROP COLUMN IF EXISTS paused_at, DROP COLUMN IF EXISTS pause_reason;").await?;
            Ok(())
        }
    }
}

mod m20260727_000035_create_workflow_notifications {
    use sea_orm_migration::prelude::*;
    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260727_000035_create_workflow_notifications"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"CREATE TABLE IF NOT EXISTS workflow_notifications (
                id UUID PRIMARY KEY, notification_uuid VARCHAR(64) NOT NULL UNIQUE,
                recipient_user_id UUID REFERENCES iam_users(id) ON DELETE SET NULL, recipient VARCHAR(120) NOT NULL,
                form_uuid VARCHAR(64) NOT NULL, record_uuid VARCHAR(64) NOT NULL,
                instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
                task_id UUID REFERENCES workflow_tasks(id) ON DELETE SET NULL,
                notification_type VARCHAR(24) NOT NULL, title VARCHAR(200) NOT NULL, content TEXT NOT NULL,
                read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL
            ); CREATE INDEX IF NOT EXISTS idx_workflow_notifications_recipient_read ON workflow_notifications (recipient_user_id, read_at, created_at DESC);"#).await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS workflow_notifications;")
                .await?;
            Ok(())
        }
    }
}

mod m20260727_000034_create_workflow_comments {
    use sea_orm_migration::prelude::*;
    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260727_000034_create_workflow_comments"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                CREATE TABLE IF NOT EXISTS workflow_comments (
                    id UUID PRIMARY KEY,
                    comment_uuid VARCHAR(64) NOT NULL UNIQUE,
                    form_uuid VARCHAR(64) NOT NULL,
                    record_uuid VARCHAR(64) NOT NULL,
                    author_user_id UUID NOT NULL REFERENCES iam_users(id) ON DELETE RESTRICT,
                    author VARCHAR(120) NOT NULL,
                    content TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workflow_comments_record
                    ON workflow_comments (form_uuid, record_uuid, created_at ASC);
            "#,
                )
                .await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS workflow_comments;")
                .await?;
            Ok(())
        }
    }
}

mod m20260727_000033_create_agent_transactions {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260727_000033_create_agent_pending_actions"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                CREATE TABLE IF NOT EXISTS agent_transactions (
                    id UUID PRIMARY KEY, action_uuid VARCHAR(64) NOT NULL UNIQUE,
                    session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
                    action_type VARCHAR(64) NOT NULL, payload_json JSONB NOT NULL,
                    summary TEXT NOT NULL, status VARCHAR(24) NOT NULL,
                    expires_at TIMESTAMPTZ NOT NULL, confirmed_at TIMESTAMPTZ,
                    error_message TEXT, created_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ
                );
                CREATE INDEX IF NOT EXISTS idx_agent_transactions_session_status
                    ON agent_transactions (session_id, status, created_at DESC);
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

mod m20260727_000032_add_agent_session_owner {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260727_000032_add_agent_session_owner"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
                ALTER TABLE agent_sessions
                    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES iam_users(id) ON DELETE CASCADE;
                CREATE INDEX IF NOT EXISTS idx_agent_sessions_owner_updated_at
                    ON agent_sessions (owner_user_id, is_pinned DESC, updated_at DESC);
            "#).await?;
            Ok(())
        }

        async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
            Ok(())
        }
    }
}

mod m20260724_000031_extend_agent_sessions {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260724_000031_extend_agent_sessions"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260723_000028_create_uploaded_files_table"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260723_000027_create_locations_table"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260723_000028_limit_locations_to_three_levels"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260723_000029_convert_locations_to_tree"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260723_000030_repair_locations_tree_schema"
        }
    }

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
    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260722_000026_add_workflow_task_assignee_user"
        }
    }
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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260722_000023_add_form_type"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260722_000024_add_automation_flow_type"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260722_000025_create_workflow_runtime_tables"
        }
    }

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
    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260720_000022_create_local_credentials"
        }
    }
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
    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260720_000021_create_user_email_addresses"
        }
    }
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
    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260720_000019_create_form_views"
        }
    }
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
    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260720_000020_remove_role_groups"
        }
    }
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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260715_000018_repair_form_storage_definitions"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260715_000017_drop_shared_form_records"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260715_000016_create_form_storage_definitions"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260714_000015_bind_agent_sessions"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260714_000014_expand_identity_user_profile"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260714_000013_create_identity_role_tables"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260714_000012_create_identity_user_tables"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260714_000011_create_identity_organization_tables"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260713_000010_create_agent_mvp_tables"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260626_000001_create_apps_table"
        }
    }

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
        OwnerName,
        RecordsCount,
        CreatedAt,
        UpdatedAt,
    }
}

mod m20260626_000002_create_form_definitions_table {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260626_000002_create_form_definitions_table"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260626_000003_create_form_schemas_table"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260626_000004_create_app_navigation_items_table"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260626_000005_create_form_records_table"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260629_000006_create_automation_flows_table"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260629_000007_add_automation_flow_versions"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260629_000008_create_automation_nodes_table"
        }
    }

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

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20260629_000009_create_automation_edges_table"
        }
    }

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

mod m20261006_000073_workflow_parallel_branches {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261006_000073_workflow_parallel_branches"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("CREATE TABLE IF NOT EXISTS workflow_branch_tokens (id UUID PRIMARY KEY, instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE, node_key VARCHAR(96) NOT NULL, status VARCHAR(24) NOT NULL, outputs JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE INDEX IF NOT EXISTS idx_workflow_branch_instance ON workflow_branch_tokens(instance_id,status); ALTER TABLE workflow_tasks ADD COLUMN IF NOT EXISTS branch_token_id UUID REFERENCES workflow_branch_tokens(id) ON DELETE SET NULL;").await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("ALTER TABLE workflow_tasks DROP COLUMN IF EXISTS branch_token_id; DROP TABLE IF EXISTS workflow_branch_tokens;").await?;
            Ok(())
        }
    }
}

mod m20261006_000074_unified_automation_engine {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261006_000074_unified_automation_engine"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            // These entities previously had no structural migration on a fresh install.
            use sea_orm::Schema;
            let schema = Schema::new(manager.get_database_backend());
            manager
                .create_table(
                    schema
                        .create_table_from_entity(
                            crate::infrastructure::entities::automation_run_entity::Entity,
                        )
                        .if_not_exists()
                        .to_owned(),
                )
                .await?;
            manager
                .create_table(
                    schema
                        .create_table_from_entity(
                            crate::infrastructure::entities::automation_run_node_entity::Entity,
                        )
                        .if_not_exists()
                        .to_owned(),
                )
                .await?;
            manager.get_connection().execute_unprepared(r#"
                ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS engine_revision INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE workflow_branch_tokens ADD COLUMN IF NOT EXISTS depth INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE workflow_branch_tokens ADD COLUMN IF NOT EXISTS error_message TEXT;
                ALTER TABLE workflow_branch_tokens ADD COLUMN IF NOT EXISTS sequence BIGSERIAL;
                ALTER TABLE workflow_branch_tokens ADD COLUMN IF NOT EXISTS parallel_group UUID;
                ALTER TABLE automation_flow_runs ADD COLUMN IF NOT EXISTS workflow_instance_id UUID REFERENCES workflow_instances(id);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_workflow_instance ON automation_flow_runs(workflow_instance_id) WHERE workflow_instance_id IS NOT NULL;
                ALTER TABLE automation_flow_run_nodes ADD COLUMN IF NOT EXISTS branch_id UUID;
                CREATE INDEX IF NOT EXISTS idx_automation_node_branch ON automation_flow_run_nodes(branch_id,status);
            "#).await?;
            Ok(())
        }
        async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
            Err(DbErr::Custom(
                "unified engine cutover cannot restore retired workflow progress".into(),
            ))
        }
    }
}

mod m20261007_000075_remove_automation_compatibility {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261007_000075_remove_automation_compatibility"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared(r#"
                ALTER TABLE automation_flows DROP COLUMN IF EXISTS trigger_event;
                ALTER TABLE automation_flow_versions DROP COLUMN IF EXISTS trigger_event;
                ALTER TABLE workflow_instances DROP COLUMN IF EXISTS engine_revision;
                ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS submitter_user_id UUID;
                CREATE INDEX IF NOT EXISTS idx_workflow_submitter_user ON workflow_instances(submitter_user_id);
            "#).await?;
            Ok(())
        }
        async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
            Err(DbErr::Custom(
                "removed automation protocols cannot be restored".into(),
            ))
        }
    }
}

mod m20261008_000078_remove_retired_field_config {
    use sea_orm_migration::prelude::*;

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261008_000078_remove_retired_field_config"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"
                UPDATE form_schemas AS schemas
                SET schema_json = jsonb_set(schemas.schema_json, '{fields}', (
                    SELECT jsonb_agg(
                        CASE WHEN jsonb_typeof(field->'props') = 'object'
                            THEN jsonb_set(field, '{props}',
                                (field->'props') - 'agentDataAccess' - 'rows' - 'step')
                            ELSE field
                        END ORDER BY position
                    )
                    FROM jsonb_array_elements(schemas.schema_json->'fields')
                        WITH ORDINALITY AS entries(field, position)
                ))
                WHERE jsonb_typeof(schemas.schema_json->'fields') = 'array'
                  AND EXISTS (
                    SELECT 1 FROM jsonb_array_elements(schemas.schema_json->'fields') AS field
                    WHERE jsonb_typeof(field->'props') = 'object'
                      AND (field->'props') ?| ARRAY['agentDataAccess', 'rows', 'step']
                  );
            "#,
                )
                .await?;
            Ok(())
        }

        async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
            Err(DbErr::Custom(
                "retired field configuration cannot be restored".into(),
            ))
        }
    }
}

mod m20261012_000079_common_execution {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261012_000079_common_execution"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(include_str!("../modules/automations/execution_schema.sql"))
                .await?;
            Ok(())
        }
        async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
            Err(DbErr::Custom(
                "execution cutover requires restoring the pre-cutover backup".into(),
            ))
        }
    }
}

// Inline modules formerly derived the same filename identity, "migrator".
// Preserve their historical applied/skipped semantics without replaying their SQL.
// Fresh databases instead apply every distinct migration exactly once.
pub async fn reconcile_legacy_names(db: &sea_orm::DatabaseConnection) -> Result<(), DbErr> {
    use sea_orm::{ConnectionTrait, DbBackend, Statement, TransactionTrait};
    let txn = db.begin().await?;
    txn.execute_unprepared("SELECT pg_advisory_xact_lock(610120079)")
        .await?;
    let exists = txn
        .query_one_raw(Statement::from_string(
            DbBackend::Postgres,
            "SELECT to_regclass('seaql_migrations') IS NOT NULL AS present",
        ))
        .await?;
    if !exists.is_some_and(|r| r.try_get::<bool>("", "present").unwrap_or(false)) {
        return Ok(());
    }
    let legacy = txn
        .query_one_raw(Statement::from_string(
            DbBackend::Postgres,
            "SELECT applied_at FROM seaql_migrations WHERE version='migrator' FOR UPDATE",
        ))
        .await?;
    if let Some(row) = legacy {
        let applied: i64 = row.try_get("", "applied_at")?;
        for name in LEGACY_INLINE_MIGRATIONS {
            txn.execute_raw(Statement::from_sql_and_values(DbBackend::Postgres,
                "INSERT INTO seaql_migrations(version,applied_at) VALUES($1,$2) ON CONFLICT DO NOTHING",
                vec![(*name).into(),applied.into()])).await?;
        }
        txn.execute_unprepared("DELETE FROM seaql_migrations WHERE version='migrator'")
            .await?;
    }
    txn.commit().await?;
    Ok(())
}
const LEGACY_INLINE_MIGRATIONS: &[&str] = &[
    "m20260904_000057_drop_agent_transactions",
    "m20260727_000036_add_workflow_pause_fields",
    "m20260727_000035_create_workflow_notifications",
    "m20260727_000034_create_workflow_comments",
    "m20260727_000032_add_agent_session_owner",
    "m20260724_000031_extend_agent_sessions",
    "m20260723_000028_create_uploaded_files_table",
    "m20260723_000027_create_locations_table",
    "m20260723_000028_limit_locations_to_three_levels",
    "m20260723_000029_convert_locations_to_tree",
    "m20260723_000030_repair_locations_tree_schema",
    "m20260722_000026_add_workflow_task_assignee_user",
    "m20260722_000023_add_form_type",
    "m20260722_000024_add_automation_flow_type",
    "m20260722_000025_create_workflow_runtime_tables",
    "m20260720_000022_create_local_credentials",
    "m20260720_000021_create_user_email_addresses",
    "m20260720_000019_create_form_views",
    "m20260720_000020_remove_role_groups",
    "m20260715_000018_repair_form_storage_definitions",
    "m20260715_000017_drop_shared_form_records",
    "m20260715_000016_create_form_storage_definitions",
    "m20260714_000015_bind_agent_sessions",
    "m20260714_000014_expand_identity_user_profile",
    "m20260714_000013_create_identity_role_tables",
    "m20260714_000012_create_identity_user_tables",
    "m20260714_000011_create_identity_organization_tables",
    "m20260713_000010_create_agent_mvp_tables",
    "m20260626_000001_create_apps_table",
    "m20260626_000002_create_form_definitions_table",
    "m20260626_000003_create_form_schemas_table",
    "m20260626_000004_create_app_navigation_items_table",
    "m20260626_000005_create_form_records_table",
    "m20260629_000006_create_automation_flows_table",
    "m20260629_000007_add_automation_flow_versions",
    "m20260629_000008_create_automation_nodes_table",
    "m20260629_000009_create_automation_edges_table",
];

mod m20261012_000080_custom_buttons {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261012_000080_custom_buttons"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared(include_str!("../modules/custom_buttons/schema.sql"))
                .await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS app_custom_buttons;")
                .await?;
            Ok(())
        }
    }
}

mod m20261014_000082_user_smtp_authorizations {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261014_000082_user_smtp_authorizations"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("CREATE TABLE user_smtp_authorizations (user_id uuid PRIMARY KEY REFERENCES iam_users(id) ON DELETE CASCADE, email text NOT NULL, encrypted_password text NOT NULL);").await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager
                .get_connection()
                .execute_unprepared("DROP TABLE IF EXISTS user_smtp_authorizations;")
                .await?;
            Ok(())
        }
    }
}

mod m20261014_000083_additional_smtp_authorizations {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261014_000083_additional_smtp_authorizations"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("ALTER TABLE user_smtp_authorizations DROP CONSTRAINT user_smtp_authorizations_pkey; ALTER TABLE user_smtp_authorizations ADD PRIMARY KEY (user_id, email);").await?;
            Ok(())
        }
        async fn down(&self, _: &SchemaManager) -> Result<(), DbErr> {
            Err(DbErr::Custom(
                "Cannot collapse multiple mailbox authorizations without losing credentials".into(),
            ))
        }
    }
}

mod m20261019_000086_button_automation {
    use sea_orm_migration::prelude::*;
    pub struct Migration;
    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m20261019_000086_button_automation"
        }
    }
    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("ALTER TABLE app_custom_buttons DROP CONSTRAINT IF EXISTS app_custom_buttons_action_type_check; ALTER TABLE app_custom_buttons ADD CONSTRAINT app_custom_buttons_action_type_check CHECK (action_type IN ('fill_form','open_page','run_automation'));").await?;
            Ok(())
        }
        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            manager.get_connection().execute_unprepared("ALTER TABLE app_custom_buttons DROP CONSTRAINT IF EXISTS app_custom_buttons_action_type_check; ALTER TABLE app_custom_buttons ADD CONSTRAINT app_custom_buttons_action_type_check CHECK (action_type IN ('fill_form','open_page'));").await?;
            Ok(())
        }
    }
}
