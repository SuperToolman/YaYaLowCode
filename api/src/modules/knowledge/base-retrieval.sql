-- Preserve the legacy platform profile as fallback for existing knowledge bases.
ALTER TABLE knowledge_bases ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE knowledge_bases ADD COLUMN retrieval_selection jsonb;
ALTER TABLE knowledge_vector_profiles ADD COLUMN base_id uuid REFERENCES knowledge_bases(id) ON DELETE CASCADE;
DROP INDEX knowledge_platform_profile_current;
DROP INDEX knowledge_platform_profile_config;
CREATE UNIQUE INDEX knowledge_platform_profile_current ON knowledge_vector_profiles(deployment_id) WHERE active AND deployment_id IS NOT NULL AND base_id IS NULL;
CREATE UNIQUE INDEX knowledge_platform_profile_config ON knowledge_vector_profiles(deployment_id,config_hash) WHERE deployment_id IS NOT NULL AND base_id IS NULL;
CREATE UNIQUE INDEX knowledge_base_profile_current ON knowledge_vector_profiles(base_id) WHERE active AND base_id IS NOT NULL;
CREATE UNIQUE INDEX knowledge_base_profile_config ON knowledge_vector_profiles(base_id,config_hash) WHERE base_id IS NOT NULL;
ALTER TABLE knowledge_provider_connections ADD COLUMN models jsonb NOT NULL DEFAULT '[]';
UPDATE knowledge_provider_connections c SET models = COALESCE((SELECT jsonb_agg(DISTINCT model) FROM (
 SELECT p.config->'settings'->>'embeddingModel' model FROM knowledge_vector_profiles p WHERE p.deployment_id=c.deployment_id AND c.provider_type='embedding' AND p.config->'settings'->>'embeddingRouteId'=c.route_id
 UNION SELECT p.config->'settings'->>'rerankerModel' FROM knowledge_vector_profiles p WHERE p.deployment_id=c.deployment_id AND c.provider_type='reranker' AND p.config->'settings'->>'rerankerRouteId'=c.route_id
) m WHERE model IS NOT NULL AND model<>''),'[]');
