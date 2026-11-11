CREATE TABLE IF NOT EXISTS agent_v2_files (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES agent_v2_sessions(id) ON DELETE CASCADE,
    run_id uuid REFERENCES agent_v2_runs(id) ON DELETE CASCADE,
    invocation_id text,
    name text NOT NULL,
    mime_type text NOT NULL,
    size bigint NOT NULL CHECK(size BETWEEN 1 AND 8388608),
    sha256 text NOT NULL,
    source text NOT NULL CHECK(source IN ('upload','generated')),
    contents bytea NOT NULL CHECK(octet_length(contents)=size),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(run_id, invocation_id)
);
CREATE INDEX IF NOT EXISTS agent_v2_files_session ON agent_v2_files(session_id, created_at, id);
