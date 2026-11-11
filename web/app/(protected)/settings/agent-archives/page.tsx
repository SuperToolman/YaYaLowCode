"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Archive, Clock, ArrowRotateLeft, ArrowRotateRight, Magnifier, TrashBin } from "@gravity-ui/icons";
import { Button, Checkbox, Modal, Spinner, Tooltip } from "@heroui/react";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { notify, notifyRequestError } from "@/shared/lib/notify";
import { archiveAction, listMessages, listEmployees, type AgentEvent, type Employee, type Session, type Message } from "@/features/agent-v2/client";
import { useSessionDirectory } from "@/features/agent-v2/session-directory";
import { ArchiveSearchModal } from "@/features/agent-v2/components/ArchiveSearchModal";
import { AgentMessage } from "@/features/agent-v2/components/AgentMessage";
import { conversationMessages } from "@/features/agent-v2/runtime-core";
import { ArchivedSessionCard } from "./components/ArchivedSessionCard";
import { SettingsContentCard } from "../components/SettingsContentCard";

export default function ArchivedSessionsPage() {
  const { user } = useAuth();
  return <ArchivedSessions key={user?.id ?? "anonymous"} />;
}
function ArchivedSessions() {
  const { permissionsReady, hasPermission } = useAuth();
  const allowed = permissionsReady && hasPermission("agent.window");
  const directory = useSessionDirectory(allowed, "", true);
  const { sessions, refreshDirectory, updateSessions } = directory;
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    void listEmployees(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setEmployees(result.items);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          notifyRequestError(reason, "加载员工信息失败");
      });
    return () => controller.abort();
  }, [allowed]);
  const employeeFor = (id: string) =>
    employees.find((item) => item.id === id) ?? {
      id,
      title: "已卸载或不可用员工",
      description: "",
    };
  const pendingDeletion = sessions.filter((s) =>
    ["queued", "running"].includes(s.deletion_status ?? ""),
  );
  const normalSessions = sessions.filter((s) => !s.deletion_status);
  const failedSessions = sessions.filter((s) => s.deletion_status === "failed");
  const visibleSessions = [...normalSessions, ...failedSessions];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const acting = useRef(false);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [viewing, setViewing] = useState<Session | null>(null);
  const currentSelection = [...selected].filter((id) =>
    sessions.some((s) => s.id === id),
  );
  const selectable = sessions.filter(
    (s) => !s.deletion_status || s.deletion_status === "failed",
  );
  const hasPendingDeletion = pendingDeletion.length > 0;
  useEffect(() => {
    if (!allowed || busy) return;
    const refresh = () => {
      if (document.visibilityState === "visible")
        void refreshDirectory({ background: true }).catch(() => undefined);
    };
    const timer = setInterval(refresh, hasPendingDeletion ? 2000 : 10000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [allowed, busy, hasPendingDeletion, refreshDirectory]);
  async function act(ids: string[], action: "restore" | "delete") {
    if (acting.current || !ids.length) return;
    acting.current = true;
    setBusy(true);
    try {
      const result = await archiveAction(ids, action);
      const failed = result.items.filter((item) => item.error);
      const accepted = result.items.length - failed.length;
      // Apply acknowledged states immediately, even if the following refresh fails.
      updateSessions((previous) =>
        previous.flatMap((session) => {
          const item = result.items.find(
            (entry) => entry.sessionId === session.id,
          );
          if (!item || item.error) return [session];
          if (action === "restore" || item.status === "completed") return [];
          return [
            { ...session, deletion_status: item.status, deletion_error: null },
          ];
        }),
      );
      if (accepted)
        notify.success(
          action === "restore"
            ? `已恢复 ${accepted} 个会话`
            : `已受理 ${accepted} 个删除请求`,
          action === "delete"
            ? {
                description:
                  "会话已移出归档列表，后台等待执行停止后清理文件和记录；清理失败会单独显示，可重试。",
              }
            : undefined,
        );
      if (failed.length)
        notify.error(`${failed.length} 个会话操作失败`, {
          description: failed
            .map((item) => item.error)
            .filter((v, i, a) => a.indexOf(v) === i)
            .join("；"),
        });
      setSelected(new Set(failed.map((item) => item.sessionId)));
      setDeleting([]);
      await refreshDirectory().catch((reason) =>
        notifyRequestError(reason, "操作已处理，列表刷新失败"),
      );
    } catch (reason) {
      notifyRequestError(reason, "归档会话操作失败");
      await refreshDirectory().catch(() => undefined);
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }
  return (
    <SettingsContentCard
      title="归档会话"
      subtitle="仅管理当前用户的归档会话"
      headerActions={
        <>
          <Tooltip>
            <Button
              isIconOnly
              variant="ghost"
              aria-label="搜索归档会话"
              isDisabled={!allowed || busy}
              onPress={() => setSearchOpen(true)}
            >
              <Magnifier />
            </Button>
            <Tooltip.Content>搜索归档会话</Tooltip.Content>
          </Tooltip>
          <Tooltip>
            <Button
              isIconOnly
              variant="ghost"
              aria-label="刷新归档会话"
              isDisabled={
                !allowed ||
                busy ||
                directory.loadingSessions ||
                directory.refreshingSessions
              }
              onPress={() =>
                void refreshDirectory().catch((reason) =>
                  notifyRequestError(reason, "刷新失败"),
                )
              }
            >
              <ArrowRotateRight />
            </Button>
            <Tooltip.Content>刷新</Tooltip.Content>
          </Tooltip>
        </>
      }
    >
      {!permissionsReady ? (
        <Spinner aria-label="加载权限" />
      ) : !allowed ? (
        <p>暂无权限访问归档会话。</p>
      ) : (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            {currentSelection.length > 0 && (
              <>
                <Button
                  variant="secondary"
                  isDisabled={
                    busy ||
                    !currentSelection.length ||
                    currentSelection.some((id) =>
                      Boolean(
                        sessions.find((s) => s.id === id)?.deletion_status,
                      ),
                    )
                  }
                  onPress={() => void act(currentSelection, "restore")}
                >
                  <ArrowRotateLeft />
                  批量恢复
                </Button>
                <Button
                  variant="danger"
                  isDisabled={busy || !currentSelection.length}
                  onPress={() => setDeleting(currentSelection)}
                >
                  <TrashBin />
                  批量彻底删除
                </Button>
              </>
            )}
          </div>
          <p className="text-sm text-muted">
            已选择 {currentSelection.length} 个会话，每批最多 100
            个。删除清理失败时可重试。
          </p>
          <div className="flex items-center gap-2">
            <Checkbox
              className="flex flex-row items-center gap-2"
              aria-label="选择已加载的可操作会话"
              isSelected={
                selectable.length > 0 &&
                selectable.slice(0, 100).every((item) => selected.has(item.id))
              }
              isDisabled={busy || !selectable.length}
              onChange={(checked) =>
                setSelected(
                  new Set(
                    checked
                      ? selectable.slice(0, 100).map((item) => item.id)
                      : [],
                  ),
                )
              }
            >
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <span>全选</span>
              </Checkbox.Content>
            </Checkbox>
          </div>
          {pendingDeletion.length > 0 && (
            <div
              role="status"
              className="flex items-center gap-2 text-sm text-muted"
            >
              {pendingDeletion.some(
                (session) => session.deletion_status === "running",
              ) ? (
                <Spinner size="sm" aria-label="正在清理会话" />
              ) : (
                <Clock aria-label="等待清理" />
              )}
              <span>
                {
                  pendingDeletion.filter((s) => s.deletion_status === "running")
                    .length
                }{" "}
                个会话正在清理，
                {
                  pendingDeletion.filter((s) => s.deletion_status === "queued")
                    .length
                }{" "}
                个等待停止或清理
              </span>
            </div>
          )}
          {visibleSessions.map((session) => (
            <Fragment key={session.id}>
              {session.id === failedSessions[0]?.id && (
                <h2 className="text-sm font-semibold text-danger">
                  清理失败（{failedSessions.length}），可重试彻底删除
                </h2>
              )}
              <ArchivedSessionCard
                key={session.id}
                session={session}
                employee={employeeFor(session.employee_id)}
                selected={selected.has(session.id)}
                disabled={busy}
                onSelect={(checked) => {
                  if (checked && currentSelection.length >= 100) {
                    notify.warning("每批最多选择 100 个会话");
                    return;
                  }
                  setSelected((previous) => {
                    const next = new Set(previous);
                    if (checked) next.add(session.id);
                    else next.delete(session.id);
                    return next;
                  });
                }}
                onView={() => setViewing(session)}
                onRestore={() => void act([session.id], "restore")}
                onDelete={() => setDeleting([session.id])}
              />
            </Fragment>
          ))}

          {directory.loadingSessions && !sessions.length && (
            <Spinner aria-label="加载归档会话" />
          )}
          {directory.sessionDirectoryError && (
            <p role="alert">归档列表刷新失败，请点击上方刷新重试。</p>
          )}
          {!directory.loadingSessions &&
            !directory.sessionDirectoryError &&
            !visibleSessions.length &&
            !pendingDeletion.length && <p>暂无匹配的归档会话。</p>}
          {directory.hasMoreSessions && (
            <Button
              variant="ghost"
              isPending={directory.loadingMoreSessions}
              isDisabled={busy || directory.loadingSessions}
              onPress={() => void directory.loadMoreSessions()}
            >
              加载更多
            </Button>
          )}
        </div>
      )}
      <Modal
        isOpen={Boolean(deleting.length)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting([]);
        }}
      >
        <Modal.Backdrop isDismissable={!busy}>
          <Modal.Container size="sm">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>彻底删除归档会话</Modal.Heading>
                <Modal.CloseTrigger isDisabled={busy} />
              </Modal.Header>
              <Modal.Body>
                <p>
                  确定彻底删除这 {deleting.length}{" "}
                  个会话吗？消息、附件、工作区文件和会话脚本环境均会清理，无法恢复。已执行的平台业务变更不会撤销。
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="ghost"
                  isDisabled={busy}
                  onPress={() => setDeleting([])}
                >
                  取消
                </Button>
                <Button
                  variant="danger"
                  isPending={busy}
                  onPress={() => void act(deleting, "delete")}
                >
                  <TrashBin />
                  确认彻底删除
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {searchOpen && (
        <ArchiveSearchModal
          employees={employees}
          onClose={() => setSearchOpen(false)}
          onView={(session) => {
            setSearchOpen(false);
            setViewing(session);
          }}
        />
      )}
      {viewing && (
        <ArchivePreview
          key={viewing.id}
          session={viewing}
          employee={employeeFor(viewing.employee_id)}
          onClose={() => setViewing(null)}
        />
      )}
    </SettingsContentCard>
  );
}
function ArchivePreview({
  session,
  employee,
  onClose,
}: {
  session: Session;
  employee: Employee;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void listMessages(session.id, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setMessages(result.items);
          setEvents((result.events ?? []) as AgentEvent[]);
          setBefore(result.next_before ?? null);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          notifyRequestError(reason, "读取归档消息失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session.id]);
  async function older() {
    if (!before || loading) return;
    setLoading(true);
    try {
      const result = await listMessages(session.id, undefined, before);
      setMessages((previous) => [...result.items, ...previous]);
      setEvents((previous) =>
        [...((result.events ?? []) as AgentEvent[]), ...previous]
          .filter(
            (item, index, all) =>
              all.findIndex((other) => other.seq === item.seq) === index,
          )
          .sort((a, b) => a.seq - b.seq),
      );
      setBefore(result.next_before ?? null);
    } catch (reason) {
      notifyRequestError(reason, "读取历史消息失败");
    } finally {
      setLoading(false);
    }
  }
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Archive />
              <Modal.Heading>{session.title}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="max-h-[70vh] overflow-y-auto">
              <div className="flex min-w-0 flex-col gap-3">
                {before && (
                  <Button
                    variant="ghost"
                    isDisabled={loading}
                    onPress={() => void older()}
                  >
                    读取更早消息
                  </Button>
                )}
                {loading && <Spinner aria-label="读取消息" />}
                {conversationMessages(messages, events, [], []).map(
                  (message) => (
                    <AgentMessage
                      key={message.id}
                      message={message}
                      employeeName={employee.title}
                      employeeAvatarUrl={`/api/ai-employees/${encodeURIComponent(employee.id)}/avatar`}
                    />
                  ),
                )}
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
