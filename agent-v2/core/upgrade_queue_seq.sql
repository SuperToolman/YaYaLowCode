-- Upgrade databases initialized by the first V2 development schema. Fresh databases
-- already have queue_seq; this migration deliberately leaves their order intact.
LOCK TABLE agent_v2_sessions, agent_v2_runs IN ACCESS EXCLUSIVE MODE;
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS queue_seq bigint;
WITH ranked AS (
 SELECT id, row_number() OVER (PARTITION BY session_id ORDER BY created_at,id) AS ordinal
 FROM agent_v2_runs
)
UPDATE agent_v2_runs r SET queue_seq=ranked.ordinal
FROM ranked WHERE r.id=ranked.id AND r.queue_seq IS NULL;
ALTER TABLE agent_v2_runs ALTER COLUMN queue_seq SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agent_v2_runs_session_queue_seq_upgrade
 ON agent_v2_runs(session_id,queue_seq);
-- New commands allocate queue_seq from the session's persistent event counter.
-- Advance it past backfilled runs even if an early development DB lacks events.
UPDATE agent_v2_sessions s SET next_seq=GREATEST(s.next_seq,
 COALESCE((SELECT max(queue_seq) FROM agent_v2_runs WHERE session_id=s.id),0),
 COALESCE((SELECT max(seq) FROM agent_v2_events WHERE session_id=s.id),0));
