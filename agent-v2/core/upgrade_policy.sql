ALTER TABLE agent_v2_confirmations ADD COLUMN IF NOT EXISTS failure jsonb;
ALTER TABLE agent_v2_confirmations DROP CONSTRAINT IF EXISTS agent_v2_confirmations_status_check;
ALTER TABLE agent_v2_confirmations ADD CONSTRAINT agent_v2_confirmations_status_check
 CHECK(status IN ('pending','approved','rejected','expired','cancelled','executed','conflict','failed'));
