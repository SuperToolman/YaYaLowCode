"use client";
import { notifyRequestError } from "@lib/notify";
import { useAuth } from "@components/AuthProvider";
import { notify } from "@lib/notify";

import { useEffect, useState } from "react";
import { Button, Modal, Table } from "@heroui/react";
import { SettingsContentCard } from "../components/SettingsContentCard";
import { fetchArchivedAgentSessions, fetchAvailableAgents, purgeArchivedAgentSession, restoreArchivedAgentSession, type ArchivedAgentSession } from "@/features/agent-workbench/platform-api";

function displayTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export default function AgentArchivePage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("settings.agent-archive.manage");
  const [sessions, setSessions] = useState<ArchivedAgentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [purging, setPurging] = useState<ArchivedAgentSession | null>(null);
  const [purgingNow, setPurgingNow] = useState(false);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try { setSessions(await fetchArchivedAgentSessions()); }
    catch (error) { notifyRequestError(error, "无法加载归档会话", { description: error instanceof Error ? error.message : "请稍后重试。" }); }
    finally { setLoading(false); }
  }

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => { void fetchAvailableAgents({ route: "/settings/agent-archive" }).then(items => setEmployeeNames(Object.fromEntries(items.map(item => [item.id, item.name])))).catch(() => undefined); }, []);

  async function restore(session: ArchivedAgentSession) {
    setRestoring(session.id);
    try {
      await restoreArchivedAgentSession(session.id);
      setSessions(current => current.filter(item => item.id !== session.id));
      notify.success("会话已恢复", { description: "已恢复到对应 AI 员工的会话列表。" });
    } catch (error) {
      notifyRequestError(error, "无法恢复会话", { description: error instanceof Error ? error.message : "请稍后重试。" });
    } finally { setRestoring(null); }
  }

  async function purge() {
    if (!purging) return;
    setPurgingNow(true);
    try {
      await purgeArchivedAgentSession(purging.id);
      setSessions(current => current.filter(item => item.id !== purging.id));
      notify.success("归档会话已永久移除");
      setPurging(null);
    } catch (error) {
      notifyRequestError(error, "无法永久移除会话", { description: error instanceof Error ? error.message : "请稍后重试。" });
    } finally { setPurgingNow(false); }
  }

  return <SettingsContentCard title="归档会话" subtitle="已归档会话不会出现在 Agent 工作台。恢复后会回到原 AI 员工的会话列表。" bodyScrollable={false} headerActions={<Button variant="ghost" isDisabled={loading} onPress={() => void load()}>刷新</Button>}>
    <Table className="h-full min-h-0">
      <Table.ScrollContainer className="h-full overflow-auto">
        <Table.Content aria-label="归档会话" className="min-w-[760px] w-full table-fixed">
          <Table.Header><Table.Column id="title" isRowHeader className="w-[30%]">会话</Table.Column><Table.Column id="employee" className="w-[25%]">AI 员工</Table.Column><Table.Column id="archived-at" className="w-[25%]">归档时间</Table.Column><Table.Column id="actions" className="w-[20%]">操作</Table.Column></Table.Header>
          <Table.Body renderEmptyState={() => <p className="py-16 text-center text-sm text-[var(--color-text-secondary)]">{loading ? "加载中..." : "暂无归档会话。"}</p>}>
            <Table.Collection items={sessions}>{session => <Table.Row key={session.id} id={session.id}><Table.Cell><span className="block truncate font-medium" title={session.title}>{session.title || "新对话"}</span></Table.Cell><Table.Cell><span className="block truncate text-[var(--color-text-secondary)]">{employeeNames[session.agentId] ?? "AI 员工"}</span></Table.Cell><Table.Cell><span className="text-[var(--color-text-secondary)]">{displayTime(session.archivedAt)}</span></Table.Cell><Table.Cell><div className="flex items-center gap-2"><Button size="sm" variant="secondary" isDisabled={!canManage || Boolean(restoring) || purgingNow} onPress={() => void restore(session)}>{restoring === session.id ? "恢复中..." : "恢复"}</Button><Button size="sm" variant="danger" isDisabled={!canManage || Boolean(restoring) || purgingNow} onPress={() => setPurging(session)}>永久移除</Button></div></Table.Cell></Table.Row>}</Table.Collection>
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
    <Modal isOpen={Boolean(purging)} onOpenChange={open => !purgingNow && !open && setPurging(null)}><Modal.Backdrop className="theme-modal-backdrop" isDismissable={!purgingNow}><Modal.Container placement="center" size="sm"><Modal.Dialog className="rounded-md bg-[var(--color-bg-surface)]"><Modal.Header><Modal.Heading>永久移除归档会话</Modal.Heading><Modal.CloseTrigger aria-label="关闭" isDisabled={purgingNow} /></Modal.Header><Modal.Body><p className="text-sm leading-6 text-[var(--color-text-secondary)]">“{purging?.title || "新对话"}”及其 Agent workspace 将被永久删除，无法恢复。</p></Modal.Body><Modal.Footer><Button variant="ghost" isDisabled={!canManage || purgingNow} onPress={() => setPurging(null)}>取消</Button><Button variant="danger" isDisabled={!canManage || purgingNow} onPress={() => void purge()}>{purgingNow ? "移除中..." : "永久移除"}</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
  </SettingsContentCard>;
}
