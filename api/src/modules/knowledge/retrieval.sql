-- K3 baseline: indexed Chinese bigrams and exact ASCII identifiers. This is
-- keyword coverage ranking, not BM25, embeddings or semantic/hybrid retrieval.
CREATE FUNCTION knowledge_keyword_terms(input text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT COALESCE(array_agg(DISTINCT term ORDER BY term),ARRAY[]::text[]) FROM (
   SELECT 'a:'||m[1] term FROM regexp_matches(lower(input),'([a-z0-9][a-z0-9._/+:-]*)','g') m
   UNION ALL
   SELECT 'c:'||substring(m[1] FROM n FOR LEAST(2,length(m[1])))
   FROM regexp_matches(input,'([一-鿿]+)','g') m
   CROSS JOIN LATERAL generate_series(1,GREATEST(length(m[1])-1,1)) n
 ) words
$$;
ALTER TABLE knowledge_chunks ADD COLUMN keyword_terms text[] GENERATED ALWAYS AS(knowledge_keyword_terms(body)) STORED;
CREATE INDEX knowledge_chunks_keywords ON knowledge_chunks USING gin(keyword_terms);
CREATE TABLE knowledge_retrievals (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES agent_v2_runs(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES iam_users(id), employee_id text NOT NULL, call_id text NOT NULL,
 query_hash text NOT NULL, scope_hash text NOT NULL, ranking_mode text NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,call_id)
);
CREATE TABLE knowledge_citations (
 id uuid PRIMARY KEY, retrieval_id uuid NOT NULL REFERENCES knowledge_retrievals(id) ON DELETE CASCADE,
 chunk_id uuid NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
 version_id uuid NOT NULL REFERENCES knowledge_document_versions(id) ON DELETE CASCADE,
 content_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(retrieval_id,chunk_id)
);
