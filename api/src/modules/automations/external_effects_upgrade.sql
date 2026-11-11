ALTER TABLE automation_execution_external_effects
    DROP CONSTRAINT IF EXISTS automation_execution_external_effects_status_check;
ALTER TABLE automation_execution_external_effects
    ADD CONSTRAINT automation_execution_external_effects_status_check
    CHECK (status IN ('requesting', 'uncertain', 'completed', 'compensating', 'compensated', 'failed', 'manual'));
ALTER TABLE automation_execution_external_effects
    ADD COLUMN IF NOT EXISTS request_config JSONB,
    ADD COLUMN IF NOT EXISTS request_context JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS result_json JSONB;

UPDATE automation_execution_external_effects
SET status='uncertain', error_message=COALESCE(error_message, 'external result was not durably recorded')
WHERE status='completed' AND compensation IS NULL;
