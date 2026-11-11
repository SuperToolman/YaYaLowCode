-- Explicit dependency order; unknown inbound dependencies fail the transaction.
-- Never use CASCADE or a name prefix: AgentV2, employees, Skills and BYOM stay.
SET LOCAL lock_timeout = '10s';
DROP TABLE IF EXISTS agent_file_links;
DROP TABLE IF EXISTS agent_files;
DROP TABLE IF EXISTS agent_session_runtime_summaries;
DROP TABLE IF EXISTS agent_transactions;
DROP TABLE IF EXISTS agent_pending_actions;
DROP TABLE IF EXISTS agent_run_steps;
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS agent_messages;
DROP TABLE IF EXISTS agent_sessions;
DROP TABLE IF EXISTS agent_runtime_reset_markers;
DROP TABLE IF EXISTS agent_definitions;
DROP TABLE IF EXISTS agent_config_profiles;
DROP TABLE IF EXISTS platform_agent_assistant_settings;
-- These resource kinds have no remaining consumer; installed Skills are shared.
DELETE FROM agent_resources WHERE kind IN ('persona', 'plugin', 'knowledge_base');
DELETE FROM iam_role_permissions WHERE permission IN ('settings.agent-archive.view', 'settings.agent-archive.manage');

-- Historical form versions must not resurrect old employee bindings on restore.
UPDATE form_schemas
SET schema_json = jsonb_set(schema_json, '{pageProps}', (schema_json->'pageProps') - 'agent')
WHERE jsonb_typeof(schema_json->'pageProps') = 'object' AND (schema_json->'pageProps') ? 'agent';
