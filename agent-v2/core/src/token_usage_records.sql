usage_records AS (
 SELECT e.session_id,e.run_id,e.payload->'inputTokens' i,e.payload->'outputTokens' o,e.payload->'totalTokens' t
 FROM agent_v2_events e WHERE e.session_id IN (SELECT id FROM usage_sessions) AND e.type='model.usage'
 UNION ALL
 -- Historical successful steps used to store provider usage only in their
 -- response snapshot. Do not count them again when the new observation exists.
 SELECT r.session_id,s.run_id,s.response_snapshot#>'{usage,usage,prompt_tokens}',s.response_snapshot#>'{usage,usage,completion_tokens}',s.response_snapshot#>'{usage,usage,total_tokens}'
 FROM agent_v2_steps s JOIN agent_v2_runs r ON r.id=s.run_id
 WHERE r.session_id IN (SELECT id FROM usage_sessions) AND s.status='completed'
 AND NOT EXISTS(SELECT 1 FROM agent_v2_events e WHERE e.session_id=r.session_id AND e.run_id=s.run_id AND e.type='model.usage' AND e.payload->>'purpose'='generation' AND e.payload->>'step'=s.ordinal::text AND e.payload->>'epoch'=s.attempt::text)
), usage_numbers AS (
 SELECT session_id,run_id,CASE WHEN jsonb_typeof(i)='number' AND i::text ~ '^[0-9]+$' THEN i::text::bigint ELSE 0 END i,
 CASE WHEN jsonb_typeof(o)='number' AND o::text ~ '^[0-9]+$' THEN o::text::bigint ELSE 0 END o,
 CASE WHEN jsonb_typeof(t)='number' AND t::text ~ '^[0-9]+$' THEN t::text::bigint ELSE NULL END t
 FROM usage_records
)
