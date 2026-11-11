"use client";
import { Tooltip } from "@heroui/react";
import type { AgentV2TokenUsage } from "@/shared/lib/http";

export function MessageTokenUsage({usage}:{usage:AgentV2TokenUsage | null}) {
  const known=Boolean(usage && usage.reported_requests>0);
  const format=(n:number)=>n.toLocaleString("zh-CN");
  return <Tooltip>
    <span tabIndex={0} className="text-xs text-muted" aria-label="当前回复 Token 用量">
      {known && usage ? `Token：输入 ${format(usage.input_tokens)} · 输出 ${format(usage.output_tokens)} · 合计 ${format(usage.total_tokens)}${usage.unreported_requests>0 ? "（记录不完整）" : ""}` : "Token：暂无供应商用量记录"}
    </span>
    <Tooltip.Content>按模型服务实际返回的用量累计本条回复所属任务，包含工具续答和历史摘要；输入包括重复发送的上下文。推理 Token 通常包含在输出中，不重复相加。未返回用量的请求无法统计；历史记录可能不完整。此统计不限制任务运行，也不代表价格或账单。</Tooltip.Content>
  </Tooltip>;
}
