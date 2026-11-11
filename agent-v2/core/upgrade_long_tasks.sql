-- Additive protocol upgrade. Preserve historical tasks and execution records.
ALTER TABLE agent_v2_runs DROP CONSTRAINT IF EXISTS agent_v2_runs_status_check;
ALTER TABLE agent_v2_runs ADD CONSTRAINT agent_v2_runs_status_check CHECK (status IN
 ('queued','running','retry_wait','cancel_requested','cancelled','completed','failed','waiting_confirmation','manual_review','paused'));
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS execution_protocol integer NOT NULL DEFAULT 1;
ALTER TABLE agent_v2_runs ALTER COLUMN execution_protocol SET DEFAULT 2;
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS budget_ms bigint NOT NULL DEFAULT 43200000 CHECK (budget_ms > 0);
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS model_limit integer NOT NULL DEFAULT 1000 CHECK (model_limit > 0);
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS model_requests integer NOT NULL DEFAULT 0;
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS active_ms bigint NOT NULL DEFAULT 0;
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS active_since timestamptz;
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS stage integer NOT NULL DEFAULT 0;
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS stage_start_step integer NOT NULL DEFAULT 0;
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS pause_reason text;
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS context_summary jsonb;
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS compacted_through integer NOT NULL DEFAULT 0;
-- Prior running work is conservatively charged from its last persisted update.
UPDATE agent_v2_runs SET active_since=updated_at WHERE status IN ('running','cancel_requested') AND active_since IS NULL;
ALTER TABLE IF EXISTS agent_v2_executions ADD COLUMN IF NOT EXISTS timeout_seconds integer;
ALTER TABLE IF EXISTS agent_v2_executions ADD COLUMN IF NOT EXISTS deadline_at timestamptz;
ALTER TABLE IF EXISTS agent_v2_executions ADD COLUMN IF NOT EXISTS stop_confirmed_at timestamptz;

-- Old Workers must not claim protocol-v2 tasks during a rolling deployment.
CREATE OR REPLACE FUNCTION agent_v2_guard_execution_protocol() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.execution_protocol >= 2 AND NEW.lease_epoch <> OLD.lease_epoch
    AND COALESCE(current_setting('yaya.agent_execution_protocol',true),'') <> '2' THEN
   RAISE EXCEPTION 'AgentV2 execution protocol mismatch: upgrade Worker before claiming tasks';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS agent_v2_execution_protocol ON agent_v2_runs;
CREATE TRIGGER agent_v2_execution_protocol BEFORE UPDATE ON agent_v2_runs
 FOR EACH ROW EXECUTE FUNCTION agent_v2_guard_execution_protocol();
