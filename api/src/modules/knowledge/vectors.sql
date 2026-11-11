-- User-owned immutable profiles: no credentials or document text are copied here.
CREATE TABLE knowledge_vector_profiles (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES iam_users(id) ON DELETE CASCADE,
 config jsonb NOT NULL, config_hash text NOT NULL, active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,config_hash)
);
CREATE UNIQUE INDEX knowledge_vector_profile_current ON knowledge_vector_profiles(user_id) WHERE active;
CREATE TABLE knowledge_vector_jobs (
 profile_id uuid NOT NULL REFERENCES knowledge_vector_profiles(id) ON DELETE CASCADE,
 generation_id uuid NOT NULL REFERENCES knowledge_index_generations(id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN('queued','processing','ready','retry_wait','failed','revoked')),
 epoch bigint NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz, available_at timestamptz NOT NULL DEFAULT now(), error_code text,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(profile_id,generation_id)
);
CREATE INDEX knowledge_vector_jobs_pending ON knowledge_vector_jobs(status,available_at,lease_until);
CREATE TABLE knowledge_vectors (
 profile_id uuid NOT NULL, generation_id uuid NOT NULL,
 chunk_id uuid NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
 embedding double precision[] NOT NULL, content_hash text NOT NULL,
 PRIMARY KEY(profile_id,chunk_id),
 FOREIGN KEY(profile_id,generation_id) REFERENCES knowledge_vector_jobs(profile_id,generation_id) ON DELETE CASCADE,
 CHECK(cardinality(embedding) BETWEEN 1 AND 4096)
);
-- Normalized vectors make the dot product equal to cosine similarity. Exact
-- authorized scan is a bounded baseline, not an HNSW/pgvector index claim.
CREATE FUNCTION knowledge_cosine_dot(a double precision[],b double precision[]) RETURNS double precision
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
 SELECT CASE WHEN cardinality(a)=cardinality(b) THEN
 (SELECT sum(x*y) FROM unnest(a,b) p(x,y)) ELSE NULL END
$$;
