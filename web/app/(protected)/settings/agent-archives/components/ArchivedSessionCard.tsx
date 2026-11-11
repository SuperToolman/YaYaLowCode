"use client";

import { Button, Card, Checkbox, Spinner, Tooltip } from "@heroui/react";
import { ArrowRotateLeft, TrashBin } from "@gravity-ui/icons";
import type { Employee, Session } from "@/features/agent-v2/client";
import { AgentEmployeeAvatar } from "@/features/agent-v2/components/AgentEmployeeAvatar";

type Props = {
  session: Session;
  employee: Employee;
  selected: boolean;
  disabled: boolean;
  onSelect: (selected: boolean) => void;
  onView: () => void;
  onRestore: () => void;
  onDelete: () => void;
};

const cleanupErrors: Record<string, string> = {
  session_cleanup_stop_unconfirmed: "等待执行停止确认已超过 5 分钟，请检查执行服务后重试；会话文件尚未删除",
  session_cleanup_active: "会话仍有脚本正在执行，请结束后重试",
  session_cleanup_review_required: "存在运行中或结果待核对的脚本，请先核对执行记录",
  session_cleanup_files_busy: "会话文件被其他程序占用，请关闭后重试",
  session_cleanup_unreadable_execution: "执行记录无法读取，需要检查执行服务存储",
  session_cleanup_identity_conflict: "会话目录归属校验失败，已阻止删除",
  session_cleanup_executor_unavailable: "执行服务不可用或清理等待超时，请检查服务后重试",
  session_cleanup_authentication_failed: "执行服务认证失败，请检查服务配置",
  session_cleanup_executor_rejected: "执行服务拒绝清理，请检查服务日志后重试",
  execution_cleanup_failed: "执行环境清理未完成，请检查执行服务后重试",
  database_cleanup_failed: "数据库记录清理失败，文件可能已清理，可重试",
};

export function ArchivedSessionCard({ session, employee, selected, disabled, onSelect, onView, onRestore, onDelete }: Props) {
  const cleaning = Boolean(session.deletion_status && session.deletion_status !== "failed");
  const unavailable = disabled || Boolean(session.deletion_status);
  const archivedAt = session.archived_at ? new Date(session.archived_at).toLocaleString() : "—";

  return (
    <Card className="w-full" variant="secondary">
      <Card.Content className="flex flex-row items-center gap-4">
        <Checkbox aria-label={`选择 ${session.title}`} isSelected={selected} isDisabled={disabled || cleaning} onChange={onSelect}>
          <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content>
        </Checkbox>
        <div className="shrink-0"><AgentEmployeeAvatar employee={employee} /></div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <button type="button" className="w-fit max-w-full cursor-pointer truncate text-left text-sm font-semibold outline-offset-4 disabled:cursor-default" disabled={unavailable} onClick={onView} title={session.title}>
            {session.title}
          </button>
          <span className="truncate text-xs text-muted">{employee.title}</span>
          <span className="text-xs text-muted sm:hidden">归档于 {archivedAt}</span>
          {session.deletion_status && <span role="status" className="text-xs text-muted">{session.deletion_status === "failed" ? (cleanupErrors[session.deletion_error ?? ""] ?? "清理失败，请重试或检查服务日志") : session.deletion_status === "queued" ? "等待清理" : "正在清理…"}</span>}
        </div>
        <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
          <span className="text-xs text-muted">归档时间</span>
          {session.archived_at ? <time className="text-xs tabular-nums text-muted" dateTime={session.archived_at}>{archivedAt}</time> : <span className="text-xs text-muted">—</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="secondary" isDisabled={unavailable} onPress={onRestore}><ArrowRotateLeft />恢复</Button>
          <Tooltip>
            <Button size="sm" isIconOnly variant="ghost" aria-label={`彻底删除 ${session.title}`} isDisabled={disabled || cleaning} onPress={onDelete}>
              {cleaning ? <Spinner size="sm" /> : <TrashBin />}
            </Button>
            <Tooltip.Content>{session.deletion_status === "failed" ? "重试彻底删除" : "彻底删除"}</Tooltip.Content>
          </Tooltip>
        </div>
      </Card.Content>
    </Card>
  );
}
