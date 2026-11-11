-- A platform deployment is not a user's department/primary organization.
CREATE TABLE knowledge_deployment_scope (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), id uuid NOT NULL UNIQUE
);
INSERT INTO knowledge_deployment_scope(singleton,id) VALUES(true,gen_random_uuid());
CREATE TABLE knowledge_bases (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('application','global','employee_bundle')),
 name text NOT NULL, application_id text REFERENCES apps(route_app_id) ON DELETE CASCADE, employee_id text,
 created_by uuid NOT NULL REFERENCES iam_users(id), client_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='application' AND application_id IS NOT NULL AND employee_id IS NULL) OR (kind='global' AND application_id IS NULL AND employee_id IS NULL) OR (kind='employee_bundle' AND employee_id IS NOT NULL AND application_id IS NULL)),
 UNIQUE(tenant_id,created_by,client_id)
);
CREATE UNIQUE INDEX knowledge_employee_base ON knowledge_bases(tenant_id,employee_id) WHERE kind='employee_bundle';
CREATE TABLE knowledge_documents (
 id uuid PRIMARY KEY, base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
 name text NOT NULL, current_version_id uuid, source_id text, package_version text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(base_id,source_id,package_version)
);
CREATE TABLE knowledge_document_versions (
 id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0), name text NOT NULL, mime_type text NOT NULL, size bigint NOT NULL CHECK(size>0 AND size<=8388608),
 sha256 text NOT NULL, contents bytea NOT NULL, created_by uuid NOT NULL REFERENCES iam_users(id), client_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'stored' CHECK(status IN ('stored','queued','processing','ready','failed')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(document_id,version), UNIQUE(document_id,client_id)
);
ALTER TABLE knowledge_documents ADD CONSTRAINT knowledge_current_version FOREIGN KEY(current_version_id) REFERENCES knowledge_document_versions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE knowledge_upload_commands (
 base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES iam_users(id),
 client_id uuid NOT NULL, fingerprint text NOT NULL, document_id uuid NOT NULL, version_id uuid NOT NULL,
 PRIMARY KEY(base_id,user_id,client_id)
);
CREATE INDEX knowledge_bases_scope ON knowledge_bases(tenant_id,kind,application_id);
CREATE INDEX knowledge_documents_base ON knowledge_documents(base_id,created_at,id);
