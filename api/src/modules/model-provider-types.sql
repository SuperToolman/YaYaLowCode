ALTER TABLE byom_model_routes
    ADD COLUMN IF NOT EXISTS provider_type text NOT NULL DEFAULT 'chat';

ALTER TABLE byom_model_routes
    DROP CONSTRAINT IF EXISTS byom_model_routes_provider_type_check;
ALTER TABLE byom_model_routes
    ADD CONSTRAINT byom_model_routes_provider_type_check
    CHECK (provider_type IN ('chat', 'speech_to_text', 'text_to_speech', 'judgment', 'embedding', 'reranker'));

UPDATE byom_model_routes
SET is_default = false
WHERE provider_type <> 'chat' AND is_default;

ALTER TABLE knowledge_provider_connections
    ADD COLUMN IF NOT EXISTS provider_type text NOT NULL DEFAULT 'embedding';
ALTER TABLE knowledge_provider_connections
    DROP CONSTRAINT IF EXISTS knowledge_provider_connections_pkey;
ALTER TABLE knowledge_provider_connections
    ADD CONSTRAINT knowledge_provider_connections_pkey PRIMARY KEY (deployment_id, provider_type, route_id);
ALTER TABLE knowledge_provider_connections
    DROP CONSTRAINT IF EXISTS knowledge_provider_connections_provider_type_check;
ALTER TABLE knowledge_provider_connections
    ADD CONSTRAINT knowledge_provider_connections_provider_type_check
    CHECK (provider_type IN ('embedding', 'reranker'));
