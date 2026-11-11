"use client";

import { Button, Card, Input, Label, ListBox, ScrollShadow, Select, Tooltip } from "@heroui/react";
import { RunProgressCard } from "@/features/agent-v2/components/RunProgressCard";
import { ConfirmationCard } from "@/features/agent-v2/components/ConfirmationCard";
import { AgentMessage } from "@/features/agent-v2/components/AgentMessage";
import { SessionActions } from "@/features/agent-v2/components/SessionActions";
import { SessionItem } from "@/features/agent-v2/components/SessionItem";
import { AgentEmployeeAvatar as EmployeeAvatar } from "@/features/agent-v2/components/AgentEmployeeAvatar";
import { runFailureMessage } from "@/features/agent-v2/runtime-core";
import { Plus } from "@gravity-ui/icons";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { PageContentLayout } from "@/shared/ui/PageContentLayout";
import { useAgentV2Workspace } from "@/features/agent-v2/runtime";
import { WorkspaceFiles } from "@/features/agent-v2/components/WorkspaceFiles";
import { ConversationViewport } from "@/features/agent-v2/components/ConversationViewport";
import { AgentMessageComposer } from "@/features/agent-v2/components/AgentMessageComposer";
import { AgentConversationLayout } from "@/features/agent-v2/components/AgentConversationLayout";

export default function AgentV2Page() {
  const { user } = useAuth();
  return <AgentV2Workspace key={user?.id ?? "anonymous"} />;
}

function AgentV2Workspace() {
  const {
    directory,
    selectedSession,
    changeSession,
    forkFrom,
    knowledgeBaseIds,
    setKnowledgeBaseIds,
    modelOptions,
    selectedModel,
    selectModel,
    effortOptions,
    reasoningEffort,
    setReasoningEffort,
    runProgress,
    historyLoaded,
    hasOlder,
    loadingOlder,
    loadOlder,
    filePreviews,
    sendPhase,
    frozen,
    abandonSend,
    workspaceFiles,
    attachments,
    uploading,
    uploadFiles,
    removeAttachment,
    confirmations,
    decide,
    permissionsReady,
    allowed,
    employees,
    employeeId,
    sessions,
    sessionId,
    draft,
    error,
    busy,
    running,
    conversation,
    selectedEmployee,
    events,
    setEmployeeId,
    setDraft,
    selectSession,
    create,
    send,
    cancel,
  } = useAgentV2Workspace();

  return (
    <PageContentLayout title="AgentV2" subtitle="AI 员工工作台">
      {!permissionsReady ? (
        <p role="status">正在加载…</p>
      ) : !allowed ? (
        <p role="alert">暂无权限访问 AgentV2。</p>
      ) : (
        <div className="grid h-full min-h-0 grid-cols-1 gap-3 md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
          <Card className="min-h-0">
            <Card.Header className="flex-row items-end">
              <Select
                aria-label="AI 员工"
                className="min-w-0 flex-1"
                selectedKey={employeeId || null}
                isDisabled={busy || frozen || uploading || !employees.length}
                placeholder="暂无已授权员工"
                onSelectionChange={(key) => {
                  if (key != null) {
                    setEmployeeId(String(key));
                    selectSession("");
                  }
                }}
              >
                <Label>AI 员工</Label>
                <Select.Trigger className="h-10 items-center gap-2 md:h-9">
                  {selectedEmployee && (
                    <EmployeeAvatar employee={selectedEmployee} compact />
                  )}
                  <Select.Value className="min-w-0 flex-1 truncate">
                    {selectedEmployee?.title ?? "暂无已授权员工"}
                  </Select.Value>
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox aria-label="已授权 AI 员工">
                    {employees.map((employee) => (
                      <ListBox.Item
                        key={employee.id}
                        id={employee.id}
                        textValue={employee.title}
                      >
                        <EmployeeAvatar employee={employee} />
                        <span className="min-w-0 flex-1 truncate">
                          {employee.title}
                        </span>
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <Tooltip>
                <Button
                  isIconOnly
                  aria-label="新建会话"
                  onPress={() => void create()}
                  isDisabled={!employeeId || busy || frozen || uploading}
                >
                  <Plus />
                </Button>
                <Tooltip.Content>新建会话</Tooltip.Content>
              </Tooltip>
            </Card.Header>
            <Card.Content className="min-h-0 flex-1">
              <div className="flex h-full min-h-0 flex-col gap-2">
                <Input
                  aria-label="搜索会话标题和消息"
                  placeholder="搜索标题和消息"
                  value={directory.search}
                  onChange={(event) =>
                    directory.setSearch(event.currentTarget.value)
                  }
                  disabled={busy || frozen || uploading}
                />
                <ScrollShadow className="min-h-0 flex-1">
                  <ListBox
                    aria-label="AgentV2 会话"
                    selectionMode="single"
                    selectedKeys={sessionId ? [sessionId] : []}
                    disabledKeys={
                      busy || frozen || uploading
                        ? sessions.map((session) => session.id)
                        : []
                    }
                    onSelectionChange={(keys) => {
                      if (keys !== "all") {
                        const key = [...keys][0];
                        if (key != null) selectSession(String(key));
                      }
                    }}
                  >
                    {sessions
                      .filter((session) => session.employee_id === employeeId)
                      .map((session) => (
                        <ListBox.Item
                          key={session.id}
                          id={session.id}
                          textValue={session.title || "新对话"}
                        >
                          <SessionItem session={session} />
                        </ListBox.Item>
                      ))}
                  </ListBox>
                </ScrollShadow>
                {directory.loadingSessions && (
                  <p role="status">正在加载会话…</p>
                )}
                {!directory.loadingSessions && !sessions.length && (
                  <p>暂无匹配会话</p>
                )}
                {directory.hasMoreSessions && (
                  <Button
                    variant="ghost"
                    isPending={directory.loadingMoreSessions}
                    isDisabled={
                      busy || frozen || uploading || directory.loadingSessions
                    }
                    onPress={() => void directory.loadMoreSessions()}
                  >
                    加载更多会话
                  </Button>
                )}
                {selectedSession && (
                  <SessionActions
                    key={selectedSession.id}
                    session={selectedSession}
                    disabled={busy || frozen || uploading}
                    onUpdate={changeSession}
                  />
                )}
              </div>
            </Card.Content>
          </Card>
          <AgentConversationLayout
            title={selectedSession?.title?.trim() || "新对话"}
            workspace={
              <WorkspaceFiles
                sessionId={sessionId || null}
                outputFiles={workspaceFiles}
                previews={filePreviews}
              />
            }
          >
            <Card.Content className="min-h-0 flex-1">
              <ConversationViewport
                key={sessionId}
                loaded={!sessionId || historyLoaded}
                hasOlder={hasOlder}
                loadingOlder={loadingOlder}
                onLoadOlder={() => void loadOlder()}
              >
                {Boolean(selectedSession?.fork_origin) && (
                  <p className="text-xs text-muted">
                    此会话来自历史分叉，文件已独立复制；历史工具和脚本环境未继承。
                  </p>
                )}
                {conversation.map((message) => {
                  const status = message.runStatus;
                  return (
                    <AgentMessage
                      key={message.id}
                      message={message}
                      employeeName={selectedEmployee?.title}
                      employeeAvatarUrl={
                        selectedEmployee
                          ? `/api/ai-employees/${encodeURIComponent(selectedEmployee.id)}/avatar`
                          : undefined
                      }
                      loading={
                        message.id.startsWith("live:") &&
                        ![
                          "completed",
                          "failed",
                          "stopped",
                          "paused",
                          "manual_review",
                        ].includes(status ?? "")
                      }
                      forkDisabled={busy || frozen || uploading}
                      onFork={
                        message.role === "assistant" &&
                        !message.id.startsWith("live:")
                          ? (key) => forkFrom(message.id, key)
                          : undefined
                      }
                      runStatus={
                        message.role === "assistant" ? status : undefined
                      }
                    />
                  );
                })}
                {runProgress
                  .filter(
                    (run) =>
                      !["completed", "failed", "cancelled"].includes(
                        run.status,
                      ),
                  )
                  .map((run) => (
                    <RunProgressCard
                      key={run.runId}
                      run={run}
                      disabled={busy}
                      onStop={() => void cancel()}
                    />
                  ))}
                {confirmations.map((confirmation) => (
                  <ConfirmationCard
                    key={confirmation.id}
                    confirmation={confirmation}
                    disabled={busy}
                    onDecision={(approve) =>
                      void decide(confirmation.id, approve)
                    }
                  />
                ))}
                {events
                  .filter((event) => event.type === "run.failed")
                  .map((event) => (
                    <p key={event.event_id} role="alert">
                      {runFailureMessage(event.payload.errorCode)}
                    </p>
                  ))}
              </ConversationViewport>
            </Card.Content>
            <Card.Footer className="shrink-0 flex-col items-stretch">
              {selectedSession?.archived_at && (
                <p>此会话已归档，恢复后可继续对话。</p>
              )}
              <AgentMessageComposer
                knowledgeBaseIds={knowledgeBaseIds}
                onKnowledgeScopeChange={setKnowledgeBaseIds}
                modelOptions={modelOptions}
                modelKey={selectedModel?.id}
                onModelChange={selectModel}
                effortOptions={effortOptions}
                reasoningEffort={reasoningEffort}
                onEffortChange={setReasoningEffort}
                thinkingEnabled={selectedModel?.route.thinkingEnabled}
                sendPhase={sendPhase}
                frozen={frozen}
                onAbandon={() => void abandonSend()}
                attachments={attachments}
                uploading={uploading}
                onUpload={(files) => void uploadFiles(files)}
                onRemoveAttachment={removeAttachment}
                value={draft}
                onChange={setDraft}
                onSend={() => void send()}
                onCancel={() => void cancel()}
                loading={busy}
                disabled={
                  !employeeId ||
                  !selectedModel ||
                  Boolean(selectedSession?.archived_at)
                }
                running={Boolean(sessionId && running)}
                error={error}
              />
            </Card.Footer>
          </AgentConversationLayout>
        </div>
      )}
    </PageContentLayout>
  );
}
