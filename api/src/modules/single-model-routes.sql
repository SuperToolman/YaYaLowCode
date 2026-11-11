-- Preserve each configured model as an independent route before retiring the
-- old array/default fields. Keep the original route id for its selected model.
ALTER TABLE byom_model_routes ADD COLUMN model text NOT NULL DEFAULT '';
CREATE TABLE byom_model_route_aliases (
    original_route_id text NOT NULL REFERENCES byom_model_routes(id) ON DELETE CASCADE,
    model text NOT NULL,
    route_id text NOT NULL REFERENCES byom_model_routes(id) ON DELETE CASCADE,
    PRIMARY KEY (original_route_id, model)
);
UPDATE byom_model_routes SET model = COALESCE(
    CASE WHEN provider_type = 'chat' THEN NULLIF(btrim(default_chat_model), '') END,
    (SELECT btrim(value) FROM jsonb_array_elements_text(models) AS value WHERE btrim(value) <> '' LIMIT 1),
    ''
);
DO $$
DECLARE r record; extra text; new_id text; new_name text; suffix integer;
BEGIN
    FOR r IN SELECT * FROM byom_model_routes LOOP
        FOR extra IN SELECT DISTINCT btrim(value) FROM jsonb_array_elements_text(r.models) AS value
            WHERE btrim(value) <> '' AND btrim(value) <> r.model LOOP
            new_id := 'model-' || md5(r.id || ':' || extra);
            new_name := left(r.name,75) || ' / ' || left(extra,60) || '_' || left(md5(extra),8);
            suffix := 1;
            WHILE EXISTS (SELECT 1 FROM byom_model_routes WHERE tenant_id = r.tenant_id
                AND created_by_user_id = r.created_by_user_id AND lower(name) = lower(new_name)) LOOP
                new_name := left(r.name,75) || ' / ' || left(extra,60) || '_' || left(md5(extra),8) || '_' || suffix;
                suffix := suffix + 1;
            END LOOP;
            INSERT INTO byom_model_routes
                (id,tenant_id,created_by_user_id,name,api_base_url,encrypted_api_key,
                 default_chat_model,models,model,enabled,is_default,thinking_enabled,
                 reasoning_protocol,default_reasoning_effort,provider_type)
            VALUES (new_id,r.tenant_id,r.created_by_user_id,new_name,r.api_base_url,r.encrypted_api_key,
                '', '[]',extra,r.enabled,false,r.thinking_enabled,
                r.reasoning_protocol,r.default_reasoning_effort,r.provider_type);
            INSERT INTO byom_model_route_aliases VALUES (r.id,extra,new_id);
        END LOOP;
    END LOOP;
END $$;
ALTER TABLE byom_model_routes DROP COLUMN models, DROP COLUMN default_chat_model;
