export const parsingStatus: Record<string, string> = {
  stored: "待解析",
  queued: "等待解析",
  processing: "解析中",
  ready: "已解析",
  failed: "解析失败",
  cancelled: "版本已停用",
};

export const parsingErrors: Record<string, string> = {
  knowledge_ocr_required: "包含扫描页，需要 OCR，当前未支持。",
  knowledge_no_extractable_text: "未找到可提取的文本。",
  knowledge_extracted_content_limit: "提取内容超出限制，请拆分文档。",
  knowledge_document_traversal_limit: "文档页数或表格规模超出限制，请拆分文档。",
  knowledge_chunk_limit: "文档分块数量超出限制，请拆分文档。",
  knowledge_table_row_limit: "单行表格内容过长，请拆分该行。",
  knowledge_parser_timeout: "解析超时或超过处理资源限制，请缩小文档。",
  knowledge_parser_version_mismatch: "办公解析程序版本过旧，请更新并重启 API 与 Office helper。",
  knowledge_parser_unavailable: "办公解析服务未就绪，请检查启动配置后重试。",
  knowledge_parser_busy: "办公解析服务繁忙，正在等待重试。",
  knowledge_source_inactive: "等待有效的员工安装与授权。",
  knowledge_source_integrity_failed: "原件完整性校验失败，请重新上传。",
  knowledge_version_superseded: "文档已更新，此版本不再处理。",
  knowledge_document_unreadable: "文档损坏、加密或格式不受支持。",
};

export function parsingLocation(location: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof location.sheet === "string") parts.push(location.sheet);
  if (typeof location.page === "number") parts.push(`第 ${location.page} 页`);
  if (typeof location.slide === "number") parts.push(`第 ${location.slide} 张幻灯片`);
  if (typeof location.line === "number") parts.push(`第 ${location.line} 行`);
  if (typeof location.row === "number") parts.push(`第 ${location.row} 行`);
  if (typeof location.columnStart === "number") parts.push(`第 ${location.columnStart}—${location.columnEnd} 列`);
  if (typeof location.unit === "number" && location.page == null && location.slide == null) parts.push(`段落 ${location.unit}`);
  if (typeof location.tableRow === "number") parts.push(`表格行 ${location.tableRow}，单元格 ${location.tableCell}`);
  if (typeof location.heading === "string" && location.heading) parts.push(location.heading);
  return parts.join(" · ");
}
