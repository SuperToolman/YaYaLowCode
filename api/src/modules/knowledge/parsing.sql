-- Parsing generations are separate from immutable source versions. No extension
-- privileges, embedding configuration or vector index is required by K2.
CREATE TABLE knowledge_index_generations (
 id uuid PRIMARY KEY, version_id uuid NOT NULL REFERENCES knowledge_document_versions(id) ON DELETE CASCADE,
 parser_version text NOT NULL, chunker_version text NOT NULL,
 status text NOT NULL CHECK(status IN('queued','processing','ready','failed','cancelled')),
 active boolean NOT NULL DEFAULT false, chunk_count integer NOT NULL DEFAULT 0,
 coverage jsonb NOT NULL DEFAULT '{}', error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(version_id,parser_version,chunker_version)
);
CREATE UNIQUE INDEX knowledge_active_generation ON knowledge_index_generations(version_id) WHERE active;
ALTER TABLE knowledge_documents ADD COLUMN parsed_version_id uuid REFERENCES knowledge_document_versions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE knowledge_jobs (
 id uuid PRIMARY KEY, generation_id uuid NOT NULL UNIQUE REFERENCES knowledge_index_generations(id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN('queued','processing','retry_wait','completed','failed','cancelled')),
 epoch bigint NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz, available_at timestamptz NOT NULL DEFAULT now(), error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_jobs_pending ON knowledge_jobs(status,available_at,lease_until);
CREATE TABLE knowledge_chunks (
 id uuid PRIMARY KEY, generation_id uuid NOT NULL REFERENCES knowledge_index_generations(id) ON DELETE CASCADE,
 ordinal integer NOT NULL, body text NOT NULL, location jsonb NOT NULL, sha256 text NOT NULL,
 UNIQUE(generation_id,ordinal)
);
INSERT INTO knowledge_index_generations(id,version_id,parser_version,chunker_version,status)
 SELECT gen_random_uuid(),v.id,'office-0.1.0-knowledge-1','structure-utf8-v1','queued'
 FROM knowledge_document_versions v JOIN knowledge_documents d ON d.current_version_id=v.id;
INSERT INTO knowledge_jobs(id,generation_id,status) SELECT gen_random_uuid(),id,'queued' FROM knowledge_index_generations;
UPDATE knowledge_document_versions SET status='queued' WHERE id IN(SELECT version_id FROM knowledge_index_generations);
