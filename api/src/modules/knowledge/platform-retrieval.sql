-- Do not silently promote one user's personal credentials to deployment credentials.
-- Preserve historical profiles/vectors inactive; an administrator explicitly saves
-- the platform configuration after upgrade.
DROP INDEX knowledge_vector_profile_current;
ALTER TABLE knowledge_vector_profiles ADD COLUMN deployment_id uuid REFERENCES knowledge_deployment_scope(id);
UPDATE knowledge_vector_profiles SET active=false WHERE active;
ALTER TABLE knowledge_vector_profiles DROP CONSTRAINT knowledge_vector_profiles_user_id_config_hash_key;
CREATE UNIQUE INDEX knowledge_platform_profile_current ON knowledge_vector_profiles(deployment_id) WHERE active AND deployment_id IS NOT NULL;
CREATE UNIQUE INDEX knowledge_platform_profile_config ON knowledge_vector_profiles(deployment_id,config_hash) WHERE deployment_id IS NOT NULL;
CREATE TABLE knowledge_provider_connections (
 deployment_id uuid NOT NULL REFERENCES knowledge_deployment_scope(id),
 route_id text NOT NULL, name text NOT NULL, api_base_url text NOT NULL,
 encrypted_api_key text NOT NULL, configured_by uuid REFERENCES iam_users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(deployment_id,route_id)
);

ALTER TABLE knowledge_vector_profiles DROP CONSTRAINT knowledge_vector_profiles_user_id_fkey;
ALTER TABLE knowledge_vector_profiles ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE knowledge_vector_profiles ADD CONSTRAINT knowledge_vector_profiles_configured_by_fkey FOREIGN KEY(user_id) REFERENCES iam_users(id) ON DELETE SET NULL;
