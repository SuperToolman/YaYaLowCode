import { knowledgeBases, knowledgeCreateBase, knowledgeDocuments, knowledgeUploadDocument, knowledgeDocumentVersions, knowledgeDeleteDocument, knowledgeDeleteBase, knowledgeDownloadVersion, knowledgeParsing, knowledgeReprocess, knowledgeSearch, knowledgeCitation, knowledgeRetrievalSettings, knowledgeSaveRetrievalSettings, knowledgeRetryVectorIndex } from "@/shared/lib/http";
import { readAuthStorage, AUTH_TOKEN_STORAGE_KEY } from "@/shared/lib/auth";
export type {
  KnowledgeBase,
  KnowledgeDocument,
  RetrievalConfig,
  RetrievalSettings,
} from "@/shared/lib/http";
function options(signal?: AbortSignal) {
  const token = readAuthStorage(AUTH_TOKEN_STORAGE_KEY);
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal,
    responseStyle: "fields" as const,
    throwOnError: true as const,
  };
}
export const listBases = (
  kind: string,
  application_id?: string,
  signal?: AbortSignal,
) =>
  knowledgeBases({ ...options(signal), query: { kind, application_id } }).then(
    (r) => r.data,
  );
export const createBase = (
  name: string,
  kind: string,
  applicationId?: string,
  clientRequestId = crypto.randomUUID(),
  configuration?: Pick<
    import("@/shared/lib/http").CreateBase,
    "description" | "retrieval"
  >,
) =>
  knowledgeCreateBase({
    ...options(),
    body: { name, kind, applicationId, clientRequestId, ...configuration },
  }).then((r) => r.data);
export const listDocuments = (id: string, signal?: AbortSignal) =>
  knowledgeDocuments({ ...options(signal), path: { base_id: id } }).then(
    (r) => r.data,
  );
export const uploadDocument = (
  id: string,
  file: File,
  documentId?: string,
  clientRequestId = crypto.randomUUID(),
) =>
  knowledgeUploadDocument({
    ...options(),
    path: { base_id: id },
    query: {
      name: file.name,
      document_id: documentId,
      client_request_id: clientRequestId,
    },
    body: file,
    headers: {
      ...options().headers,
      "content-type": "application/octet-stream",
    },
  }).then((r) => r.data);
export const listVersions = (id: string) =>
  knowledgeDocumentVersions({ ...options(), path: { document_id: id } }).then(
    (r) => r.data,
  );
export const deleteDocument = (id: string) =>
  knowledgeDeleteDocument({ ...options(), path: { document_id: id } });
export const deleteBase = (id: string) =>
  knowledgeDeleteBase({ ...options(), path: { base_id: id } });
export async function downloadDocument(id: string, name: string) {
  const r = await knowledgeDownloadVersion({
    ...options(),
    path: { version_id: id },
    parseAs: "blob",
  });
  const url = URL.createObjectURL(r.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const readParsing = (id: string, offset = 0, signal?: AbortSignal) =>
  knowledgeParsing({
    ...options(signal),
    path: { version_id: id },
    query: { offset },
  }).then((r) => r.data);
export const reprocessDocument = (id: string) =>
  knowledgeReprocess({ ...options(), path: { version_id: id } }).then(
    (r) => r.data,
  );

export const searchKnowledge = (baseId: string, query: string) =>
  knowledgeSearch({ ...options(), body: { baseId, query, limit: 5 } }).then(
    (r) => r.data,
  );
export const readCitation = (id: string, signal?: AbortSignal) =>
  knowledgeCitation({ ...options(signal), path: { citation_id: id } }).then(
    (r) => r.data,
  );

export const readRetrievalSettings = (signal?: AbortSignal, baseId?: string) =>
  knowledgeRetrievalSettings({
    ...options(signal),
    query: { base_id: baseId },
  }).then((r) => r.data);
export const saveRetrievalSettings = (
  body: import("@/shared/lib/http").RetrievalConfig,
) => knowledgeSaveRetrievalSettings({ ...options(), body }).then((r) => r.data);
export const retryVectorIndex = (baseId?: string) =>
  knowledgeRetryVectorIndex({ ...options(), query: { base_id: baseId } }).then(
    (r) => r.data,
  );
