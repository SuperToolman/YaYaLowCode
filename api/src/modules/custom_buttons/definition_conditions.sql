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
