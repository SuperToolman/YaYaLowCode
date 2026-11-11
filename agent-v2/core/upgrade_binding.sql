ALTER TABLE agent_v2_confirmations ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE agent_v2_confirmations ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE agent_v2_confirmations ADD COLUMN IF NOT EXISTS employee_id text;
UPDATE agent_v2_confirmations c SET tenant_id=s.tenant_id,owner_user_id=s.owner_user_id,employee_id=s.employee_id FROM agent_v2_sessions s WHERE s.id=c.session_id AND (c.tenant_id IS NULL OR c.owner_user_id IS NULL OR c.employee_id IS NULL);
ALTER TABLE agent_v2_confirmations ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE agent_v2_confirmations ALTER COLUMN owner_user_id SET NOT NULL;
ALTER TABLE agent_v2_confirmations ALTER COLUMN employee_id SET NOT NULL;
