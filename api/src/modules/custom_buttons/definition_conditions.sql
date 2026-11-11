UPDATE app_custom_buttons
   SET availability = '{"mode":"all","rules":[]}'::jsonb,
       disabled_reason = ''
 WHERE availability IS DISTINCT FROM '{"mode":"all","rules":[]}'::jsonb
    OR disabled_reason <> '';

UPDATE form_views
   SET config_json = jsonb_set(
       config_json::jsonb,
       '{customButtons}',
       COALESCE((
           SELECT jsonb_agg(jsonb_build_object('buttonId', binding->>'buttonId'))
             FROM jsonb_array_elements(config_json::jsonb->'customButtons') AS binding
       ), '[]'::jsonb),
       true
   )
 WHERE jsonb_typeof(config_json::jsonb->'customButtons') = 'array';

-- Remove bindings left behind by deleted or migrated form-owned definitions.
-- The relationship is scoped by form_uuid; application ownership is irrelevant.
UPDATE form_views v
   SET config_json = jsonb_set(
       v.config_json::jsonb,
       '{customButtons}',
       COALESCE((
           SELECT jsonb_agg(binding ORDER BY ord)
             FROM jsonb_array_elements(v.config_json::jsonb->'customButtons') WITH ORDINALITY AS entries(binding, ord)
            WHERE binding->>'buttonId' IS NOT NULL
              AND EXISTS (
                  SELECT 1
                    FROM app_custom_buttons b
                   WHERE b.form_uuid = v.form_uuid
                     AND b.button_uuid = binding->>'buttonId'
              )
       ), '[]'::jsonb),
       true
   )
 WHERE jsonb_typeof(v.config_json::jsonb->'customButtons') = 'array';
