-- Retire application-owned buttons and their view bindings without guessing ownership.
-- Once converted, rerunning this migration preserves all new form-owned buttons.
DO $$ BEGIN
 IF EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'app_custom_buttons'
     AND column_name IN ('button_scope', 'scope_form_uuid', 'fill_scope')
 ) OR NOT EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'app_custom_buttons'
     AND column_name = 'form_uuid'
 ) THEN
   DELETE FROM app_custom_buttons;
   UPDATE form_views SET config_json = config_json::jsonb - 'customButtons'
     WHERE config_json::jsonb ? 'customButtons';
 END IF;
END $$;
ALTER TABLE app_custom_buttons DROP COLUMN IF EXISTS button_scope;
ALTER TABLE app_custom_buttons DROP COLUMN IF EXISTS scope_form_uuid;
ALTER TABLE app_custom_buttons DROP COLUMN IF EXISTS fill_scope;
ALTER TABLE app_custom_buttons ADD COLUMN IF NOT EXISTS form_uuid VARCHAR(80)
  NOT NULL REFERENCES form_definitions(form_uuid) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_custom_buttons_form_updated
  ON app_custom_buttons(form_uuid, updated_at DESC);
DROP INDEX IF EXISTS idx_app_custom_buttons_app_updated;

-- Source-less button definitions belonged to the removed public-component feature.
DELETE FROM automation_flow_versions WHERE flow_id IN (
  SELECT id FROM automation_flows WHERE trigger_form_uuid IS NULL
    AND trigger_config::jsonb -> 'triggerEvents' = '["button_click"]'::jsonb
);
DELETE FROM automation_nodes WHERE flow_id IN (
  SELECT id FROM automation_flows WHERE trigger_form_uuid IS NULL
    AND trigger_config::jsonb -> 'triggerEvents' = '["button_click"]'::jsonb
);
DELETE FROM automation_edges WHERE flow_id IN (
  SELECT id FROM automation_flows WHERE trigger_form_uuid IS NULL
    AND trigger_config::jsonb -> 'triggerEvents' = '["button_click"]'::jsonb
);
DELETE FROM automation_flows WHERE trigger_form_uuid IS NULL
  AND trigger_config::jsonb -> 'triggerEvents' = '["button_click"]'::jsonb;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint
   WHERE conrelid = 'automation_flows'::regclass
     AND conname = 'automation_button_source_required') THEN
   ALTER TABLE automation_flows ADD CONSTRAINT automation_button_source_required
     CHECK (trigger_config::jsonb -> 'triggerEvents' IS DISTINCT FROM '["button_click"]'::jsonb
       OR (trigger_form_uuid IS NOT NULL AND btrim(trigger_form_uuid) <> ''));
 END IF;
END $$;
