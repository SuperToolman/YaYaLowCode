export const retrievalReasons: Record<string, string> = {
  embedding_not_configured_for_this_task: "本轮未启用向量检索",
  embedding_index_building_or_failed:
    "向量索引尚未就绪，可在知识库中查看进度或重试",
  exact_vector_scope_limit_20000_chunks:
    "知识范围超过当前精确向量检索容量，请缩小范围",
  embedding_dimension_mismatch: "Embedding实际输出维度与配置不一致",
  embedding_provider_unavailable_or_changed:
    "Embedding供应商已停用、地址变更或不可用",
  reranker_provider_unavailable_or_changed:
    "重排供应商已停用、地址变更或不可用",
  provider_authentication_failed: "供应商认证失败，请检查密钥",
  provider_model_or_protocol_invalid: "模型名称或供应商接口不兼容",
  provider_rate_limited: "供应商请求过于频繁",
  provider_http_failed: "供应商服务异常",
  provider_network_or_timeout: "供应商连接失败或超时",
  provider_invalid_json: "供应商响应格式不正确",
  provider_response_interrupted: "供应商响应中断",
  provider_response_too_large: "供应商响应超过大小限制",
  embedding_response_contract_invalid: "Embedding返回的向量格式不正确",
  reranker_response_contract_invalid: "重排返回的排序格式不正确",
  source_permission_or_version_revoked: "来源权限或文档版本已失效",
  profile_unavailable: "当前知识检索配置已变更或不可用",
  profile_changed: "知识检索配置已变更",
  embedding_storage_unavailable: "向量存储暂时不可用",
  embedding_storage_failed: "向量保存失败",
  vector_query_failed: "向量查询失败或超时",
  no_authorized_parsed_sources: "范围内暂无可读取的已解析资料",
};
export function retrievalReason(value: string): string {
  if (value.startsWith("reranker_fallback_to_rrf:"))
    return `重排暂不可用，使用融合结果：${retrievalReason(value.split(":")[1])}`;
  return retrievalReasons[value] ?? value;
}
export function retrievalMode(mode: string) {
  return mode === "per-base-hybrid-rrf-v1"
    ? "跨库混合检索"
    : mode === "hybrid-rrf-k60-reranked-v1"
      ? "混合检索 · 已重排"
      : mode === "hybrid-rrf-k60-v1"
        ? "混合检索"
        : mode === "read_document"
          ? "来源原文"
          : "关键词检索";
}
