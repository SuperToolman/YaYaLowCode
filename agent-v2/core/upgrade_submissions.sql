CREATE TABLE IF NOT EXISTS agent_v2_submissions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL, client_id uuid NOT NULL,
 employee_id text NOT NULL, session_id uuid REFERENCES agent_v2_sessions(id),
 payload jsonb NOT NULL, fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','committed','abandoned','expired')),
 result jsonb, expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,user_id,client_id)
);
ALTER TABLE agent_v2_runs ADD COLUMN IF NOT EXISTS attachment_prepare_deadline timestamptz;
CREATE INDEX IF NOT EXISTS agent_v2_submissions_cleanup ON agent_v2_submissions(status,expires_at);
CREATE TABLE IF NOT EXISTS agent_v2_staged_files (
 submission_id uuid NOT NULL REFERENCES agent_v2_submissions(id) ON DELETE CASCADE,
 id uuid NOT NULL, name text NOT NULL, size bigint NOT NULL CHECK(size BETWEEN 1 AND 8388608),
 sha256 text NOT NULL, mime_type text, contents bytea,
 PRIMARY KEY(submission_id,id), CHECK(contents IS NULL OR octet_length(contents)=size)
);
CREATE TABLE IF NOT EXISTS agent_v2_file_previews (
 file_id uuid NOT NULL REFERENCES agent_v2_files(id) ON DELETE CASCADE,
 sha256 text NOT NULL, parser_version text NOT NULL, rule_version integer NOT NULL,
 status text NOT NULL CHECK(status IN ('parsing','completed','failed','skipped')),
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(file_id,sha256,parser_version,rule_version)
);
