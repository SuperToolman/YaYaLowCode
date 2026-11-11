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
