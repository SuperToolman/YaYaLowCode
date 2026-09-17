import {
  createKnowledgeBase,
  createPlugin,
  deleteKnowledgeBase,
  deletePlugin,
  listKnowledgeBases,
  listPlugins,
  updateKnowledgeBase,
  updatePlugin,
} from "@lib/api-client";
import { ApiRequestError, type ApiEnvelope } from "@lib/api-request";

export type AgentResourceKind = "plugin" | "knowledge";

function unwrap<T>(data: ApiEnvelope<T> | undefined, error: unknown, fallback: string): T {
  if (error || data?.code !== 0 || data.data === null) {
    throw new ApiRequestError(data?.message || fallback, 0, "business", data?.code, { cause: error });
  }
  return data.data;
}

export async function listAgentResources<T>(kind: AgentResourceKind) {
  const result = kind === "plugin"
    ? await listPlugins({ responseStyle: "fields" })
    : await listKnowledgeBases({ responseStyle: "fields" });
  return unwrap(result.data as ApiEnvelope<T> | undefined, result.error, "无法加载资源");
}

export async function saveAgentResource<T>(kind: AgentResourceKind, id: string | null, body: unknown) {
  if (kind === "plugin") {
    const result = id
      ? await updatePlugin({ path: { id }, body: body as never, responseStyle: "fields" })
      : await createPlugin({ body: body as never, responseStyle: "fields" });
    return unwrap(result.data as ApiEnvelope<T> | undefined, result.error, "保存插件失败");
  }
  const result = id
    ? await updateKnowledgeBase({ path: { id }, body: body as never, responseStyle: "fields" })
    : await createKnowledgeBase({ body: body as never, responseStyle: "fields" });
  return unwrap(result.data as ApiEnvelope<T> | undefined, result.error, "保存知识库失败");
}

export async function deleteAgentResource<T>(kind: AgentResourceKind, id: string) {
  const result = kind === "plugin"
    ? await deletePlugin({ path: { id }, responseStyle: "fields" })
    : await deleteKnowledgeBase({ path: { id }, responseStyle: "fields" });
  return unwrap(result.data as ApiEnvelope<T> | undefined, result.error, "删除资源失败");
}
