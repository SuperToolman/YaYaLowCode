CREATE TABLE IF NOT EXISTS agent_v2_executions (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES agent_v2_runs(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES agent_v2_sessions(id) ON DELETE CASCADE,
 call_id text NOT NULL, fingerprint text NOT NULL, epoch bigint NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','running','succeeded','failed','timed_out','cancelled','outcome_unknown')),
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id,call_id)
);
CREATE INDEX IF NOT EXISTS agent_v2_executions_session ON agent_v2_executions(session_id,created_at);
ALTER TABLE agent_v2_files ADD COLUMN IF NOT EXISTS artifact_key text NOT NULL DEFAULT '';
ALTER TABLE agent_v2_files DROP CONSTRAINT IF EXISTS agent_v2_files_run_id_invocation_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS agent_v2_files_invocation_artifact ON agent_v2_files(run_id,invocation_id,artifact_key);
-- Old snapshots contained execution-only configuration in generated prompt suffixes.
-- Clear only snapshots/requests containing the exact generated marker, never user messages.
UPDATE agent_v2_runs SET context_snapshot=jsonb_set(context_snapshot-'system_prompt','{policy_version}','0') WHERE context_snapshot->>'system_prompt' LIKE '%平台提供了当前 Skill 的运行环境变量（JSON 数据）：%';
UPDATE agent_v2_steps SET request_snapshot=request_snapshot-'systemPrompt' WHERE request_snapshot->>'systemPrompt' LIKE '%平台提供了当前 Skill 的运行环境变量（JSON 数据）：%';
