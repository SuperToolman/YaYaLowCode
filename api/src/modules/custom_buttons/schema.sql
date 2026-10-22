CREATE TABLE IF NOT EXISTS app_custom_buttons (
 id UUID PRIMARY KEY,
 button_uuid VARCHAR(40) NOT NULL UNIQUE,
 app_route_app_id VARCHAR(80) NOT NULL REFERENCES apps(route_app_id) ON DELETE CASCADE,
 form_uuid VARCHAR(80) NOT NULL REFERENCES form_definitions(form_uuid) ON DELETE CASCADE,
 name VARCHAR(100) NOT NULL,
 icon VARCHAR(64),
 description TEXT NOT NULL DEFAULT '',
 action_type VARCHAR(32) NOT NULL CHECK (action_type IN ('fill_form','open_page','run_automation')),
 action_config JSONB NOT NULL,
 availability JSONB NOT NULL,
 disabled_reason TEXT NOT NULL DEFAULT '',
 created_by UUID NOT NULL,
 updated_by UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custom_buttons_form_updated ON app_custom_buttons(form_uuid,updated_at DESC);
DO $$ DECLARE app_owner TEXT; BEGIN
 SELECT pg_get_userbyid(relowner) INTO app_owner FROM pg_class WHERE oid='apps'::regclass;
 IF app_owner <> current_user THEN
 EXECUTE format('ALTER TABLE app_custom_buttons OWNER TO %I',app_owner);
 END IF;
END $$;
