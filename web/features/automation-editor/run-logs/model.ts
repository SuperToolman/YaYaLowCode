import type { ApiAutomationRunNode } from "../api";

export const runStatusLabels: Record<string, string> = {
  success: "成功", failed: "失败", queued: "排队中", running: "运行中", waiting: "等待处理",
  waiting_join: "等待汇合", compensating: "补偿中", paused: "已暂停", needs_attention: "待核实",
  rejected: "已驳回", cancelled: "已取消", skipped: "已跳过",
};
export const nodeKindLabels: Record<string, string> = {
  trigger: "触发器", "add-data": "新增数据", "update-data": "更新数据", "delete-data": "删除数据",
  "get-one": "获取单条数据", "get-many": "获取多条数据", condition: "条件分支",
  "parallel-condition": "并行条件", "initiate-approval": "发起审批", approval: "审批人", executor: "执行人", copy: "抄送人", "http-request": "连接器",
};
export function orderRunNodes(nodes: ApiAutomationRunNode[]) {
  return [...nodes].sort((a, b) => {
    const difference = Date.parse(a.startedAt) - Date.parse(b.startedAt);
    return Number.isFinite(difference) ? difference : 0;
  });
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function sourceRecordId(source: unknown, payload: unknown): string {
  const metadata = object(source);
  const data = object(payload);
  const id = metadata.recordUuid ?? metadata.record_uuid ?? data.__automationRecordUuid ?? data.instanceId;
  return typeof id === "string" && id ? id : "—";
}
export function logTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
export function logDuration(value?: number | null) {
  if (value == null) return "—";
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`;
}
