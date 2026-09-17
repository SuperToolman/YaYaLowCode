"use client";

import {
  ArrowChevronLeft,
  ArrowChevronRight,
  CircleStop,
  FaceRobot,
  Plus,
} from "@gravity-ui/icons";
import { Button, Card, ScrollShadow, Tooltip } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  agentFileDownloadUrl,
  cancelAgentRun,
  createAgentSessionData,
  deleteAgentSessionData,
  fetchAgentArtifacts,
  fetchAgentFiles,
  fetchAgentMessages,
  fetchAgentRunStatus,
  fetchAgentSessions,
  fetchAvailableAgents,
  openAgentMessageStream,
  uploadAgentFile,
  updateAgentSessionData,
  type AgentFile,
} from "@/features/agent-assistant/api";
import { parseAgentSseFrame } from "@/features/agent-assistant/sse";
import type {
  AgentMessage,
  AgentOption,
  AgentPageContext,
  AgentRunStatus,
  AgentSession,
  AgentSseEvent,
  AgentToolActivity,
  AgentTimelineItem,
} from "@/features/agent-assistant/types";
import { PageContentLayout } from "@components/PageContentLayout";
import {
  AgentMessage as AgentMessageView,
  AgentMessageComposer,
} from "@/features/agent-assistant/components";
import {
  AgentEmployeeCard,
  SessionItem,
  WorkspaceFiles,
} from "@/features/agent-workbench/components";
import { createRandomUuid } from "@/app/lib/random-uuid";
import { MySurface } from "@shared/ui/MySurface";

const pageContext: AgentPageContext = { route: "/agent" };

export default function AgentPage() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("cordis-default");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [runningAssistantId, setRunningAssistantId] = useState<string | null>(
    null,
  );
  const [sessionRunStates, setSessionRunStates] = useState<
    Record<string, AgentRunStatus>
  >({});
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [artifacts, setArtifacts] = useState<AgentFile[]>([]);
  const [pendingFiles, setPendingFiles] = useState<
    Array<{ file: File; key: string }>
  >([]);
  const endRef = useRef<HTMLDivElement>(null);
  const visibleSessions = useMemo(
    () => sessions.filter((session) => session.agentId === selectedAgentId),
    [sessions, selectedAgentId],
  );
  const activeRunStatus = activeId ? sessionRunStates[activeId] : undefined;
  const activeRun = isActiveRun(activeRunStatus);
  const lastAssistantMessageId = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant")?.id,
    [messages],
  );

  useEffect(() => {
    void (async () => {
      try {
        const [a, s] = await Promise.all([
          fetchAvailableAgents(pageContext),
          fetchAgentSessions(),
        ]);
        setAgents(a);
        const availableSessions = s.filter((x) =>
          a.some((y) => y.id === x.agentId),
        );
        setSessions(availableSessions);
        const states = await Promise.all(
          availableSessions.map(async (session) => {
            try {
              const runtime = await fetchAgentRunStatus(session.id);
              return [session.id, toAgentRunStatus(runtime.status)] as const;
            } catch {
              return [session.id, undefined] as const;
            }
          }),
        );
        setSessionRunStates(
          Object.fromEntries(
            states.filter(
              (entry): entry is readonly [string, AgentRunStatus] =>
                entry[1] !== undefined,
            ),
          ),
        );
        if (a[0]) setSelectedAgentId(a[0].id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "无法加载 Agent");
      }
    })();
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  async function selectSession(id: string) {
    setActiveId(id);
    setWorkspaceOpen(false);
    setError(null);
    try {
      const [history, sessionFiles, outputs, runtime] = await Promise.all([
        fetchAgentMessages(id),
        fetchAgentFiles(id),
        fetchAgentArtifacts(id),
        fetchAgentRunStatus(id),
      ]);
      const resolved = history.map((message) => ({
        ...message,
        files: message.files?.map(
          (file) => sessionFiles.find((item) => item.id === file.id) ?? file,
        ),
      }));
      const lastAssistant = [...resolved]
        .reverse()
        .findIndex((message) => message.role === "assistant");
      if (lastAssistant >= 0 && outputs.length) {
        const index = resolved.length - 1 - lastAssistant;
        resolved[index] = { ...resolved[index], sessionId: id, files: primaryArtifacts(outputs) };
      }
      const runStatus = toAgentRunStatus(runtime.status);
      if (runStatus) {
        setSessionRunStates((items) => ({ ...items, [id]: runStatus }));
      }
      if (runtime.status === "running") {
        const runtimeAssistantId = `runtime-${id}`;
        if (!resolved.some((message) => message.id === runtimeAssistantId)) {
          resolved.push({
            id: runtimeAssistantId,
            sessionId: id,
            role: "assistant",
            content: "",
            files: undefined,
          });
        }
        setRunningAssistantId(runtimeAssistantId);
      } else {
        setRunningAssistantId(null);
      }
      setMessages(resolved);
      setFiles(sessionFiles);
      setArtifacts(outputs);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载消息");
    }
  }
  function newSession() {
    setActiveId(null);
    setMessages([]);
    setFiles([]);
    setArtifacts([]);
    setPendingFiles([]);
    setRunningAssistantId(null);
    setEditingSessionId(null);
    setEditingSessionTitle("");
    setWorkspaceOpen(false);
    setLoading(false);
    setError(null);
  }
  async function upload(selectedFiles: File[]) {
    if (!agents.some((agent) => agent.id === selectedAgentId)) {
      setError("当前没有可用的 AI 员工");
      return;
    }
    const invalid = selectedFiles.find(
      (file) => file.size === 0 || file.size > 50 * 1024 * 1024,
    );
    if (invalid) {
      setError("文件大小必须在 1B 到 50MB 之间");
      return;
    }
    const candidates = await Promise.all(
      selectedFiles.map(async (file) => ({
        file,
        key: await fileFingerprint(file),
      })),
    );
    const duplicate = candidates.some(
      (candidate, index) =>
        files.some((item) => item.checksum === candidate.key) ||
        pendingFiles.some((item) => item.key === candidate.key) ||
        candidates.findIndex((item) => item.key === candidate.key) !== index,
    );
    if (duplicate) return;
    setError(null);
    setPendingFiles((items) => [
      ...items,
      ...candidates.filter(
        (candidate) => !items.some((item) => item.key === candidate.key),
      ),
    ]);
  }
  function selectAgent(id: string) {
    setSelectedAgentId(id);
    const session = sessions.find((x) => x.agentId === id);
    if (session) void selectSession(session.id);
    else newSession();
  }
  async function stopActiveRun() {
    if (!activeId || !activeRun) return;
    try {
      await cancelAgentRun(activeId);
      setSessionRunStates((items) => ({ ...items, [activeId]: "stopped" }));
      setLoading(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法停止当前任务");
    }
  }
  useEffect(() => {
    if (!activeId || !activeRun) return;
    let disposed = false;
    const sessionId = activeId;
    const refreshStatus = async () => {
      try {
        const runtime = await fetchAgentRunStatus(sessionId);
        if (disposed) return;
        const nextStatus = toAgentRunStatus(runtime.status);
        if (nextStatus) {
          setSessionRunStates((items) => ({ ...items, [sessionId]: nextStatus }));
        }
        if (runtime.status !== "running") {
          setLoading(false);
          setRunningAssistantId(null);
          const [history, outputs] = await Promise.all([
            fetchAgentMessages(sessionId),
            fetchAgentArtifacts(sessionId),
          ]);
          if (!disposed && sessionId === activeId) {
            setMessages(history);
            setArtifacts(outputs);
          }
        }
      } catch {
        // The active HTTP stream remains the source of updates while connected.
      }
    };
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeId, activeRun]);
  async function send() {
    const content = input.trim();
    if (!content || loading || !agents.some((x) => x.id === selectedAgentId))
      return;
    setInput("");
    setLoading(true);
    setError(null);
    let assistantId: string | undefined;
    let runSessionId = activeId;
    let runFailed = false;
    let terminalStatus: AgentRunStatus | undefined;
    try {
      let id = activeId;
      let createdForSend = false;
      if (!id) {
        const created = await createAgentSessionData(
          pageContext,
          selectedAgentId,
        );
        id = created.id;
        runSessionId = id;
        createdForSend = true;
        setActiveId(id);
        setSessions((x) => [created, ...x]);
        const titled = await updateAgentSessionData(id, {
          title: content.slice(0, 80),
        });
        setSessions((x) =>
          x.map((item) => (item.id === titled.id ? titled : item)),
        );
      }
      let uploadedFiles: AgentFile[] = [];
      try {
        uploadedFiles = await Promise.all(
          pendingFiles.map(({ file }) => uploadAgentFile(id as string, file)),
        );
      } catch (reason) {
        if (createdForSend && id) {
          await deleteAgentSessionData(id).catch(() => undefined);
          setSessions((items) => items.filter((item) => item.id !== id));
          setActiveId(null);
        }
        throw reason;
      }
      setFiles((items) => [...items, ...uploadedFiles]);
      setPendingFiles([]);
      const assistantMessageId = createRandomUuid();
      assistantId = assistantMessageId;
      setRunningAssistantId(assistantMessageId);
      setSessionRunStates((items) => ({
        ...items,
        [id as string]: "thinking",
      }));
      setMessages((x) => [
        ...x,
        {
          id: createRandomUuid(),
          sessionId: id,
          role: "user",
          content,
          files: uploadedFiles,
        },
        {
          id: assistantMessageId,
          sessionId: id,
          role: "assistant",
          content: "",
        },
      ]);
      const reader = (
        await openAgentMessageStream(
          id,
          content,
          pageContext,
          selectedAgentId,
          undefined,
          uploadedFiles.map((file) => file.id),
        )
      ).body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        if (chunk.done && buffer.trim()) buffer += "\n\n";
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const event = parseAgentSseFrame(frame);
          if (event?.type === "dsh.session.event") {
            const status = applyDshEvent(
              event.event,
              assistantMessageId,
              setMessages,
            );
            if (status)
              setSessionRunStates((items) => ({
                ...items,
                [id as string]: status,
              }));
            if (status === "completed" || status === "failed" || status === "stopped") {
              terminalStatus = status;
            }
          } else if (event?.type === "artifact.created") {
            const artifact = {
              id: event.id,
              name: event.name,
              mimeType: event.mimeType ?? "application/octet-stream",
              size: event.size ?? 0,
              kind: "output",
            };
            setArtifacts((items) =>
              items.some((item) => item.id === event.id)
                ? items
                : [...items, artifact],
            );
            setMessages((items) =>
              items.map((item) =>
                item.id === assistantMessageId
                  ? {
                      ...item,
                      sessionId: id as string,
                      files: primaryArtifacts([...(item.files ?? []), artifact]),
                    }
                  : item,
              ),
            );
          } else if (event?.type === "run.completed") {
            terminalStatus = "completed";
            setSessionRunStates((items) => ({
              ...items,
              [id as string]: "completed",
            }));
          } else if (
            event?.type === "run.failed" ||
            event?.type === "message.failed"
          ) {
            runFailed = true;
            terminalStatus = "failed";
            setSessionRunStates((items) => ({
              ...items,
              [id as string]: "failed",
            }));
            throw new Error(event.message);
          }
        }
        if (chunk.done) break;
      }
      window.dispatchEvent(new Event("yaya-apps-updated"));
    } catch (reason) {
      if (assistantId) runFailed = true;
      const message =
        reason instanceof Error ? reason.message : "Agent 请求失败";
      setError(message);
      setMessages((items) =>
        items.map((item) =>
          item.id === assistantId && !item.content
            ? { ...item, content: `Agent 运行失败：${message}` }
            : item,
        ),
      );
    } finally {
      setLoading(false);
      const settledSessionId = runSessionId;
      if (settledSessionId && assistantId)
        setSessionRunStates((items) => ({
          ...items,
          [settledSessionId]: runFailed ? "failed" : terminalStatus ?? items[settledSessionId] ?? "completed",
        }));
    }
  }
  return (
    <PageContentLayout
      title="Agent"
      subtitle="AI 员工工作台"
      actions={
        <div className="flex items-center gap-1">
          <Tooltip>
            <Tooltip.Trigger>
              <Button isIconOnly aria-label="新会话" isDisabled={loading || activeRun || !agents.length} onPress={newSession}><Plus /></Button>
            </Tooltip.Trigger>
            <Tooltip.Content>新会话</Tooltip.Content>
          </Tooltip>
          <Tooltip>
            <Tooltip.Trigger>
              <Button isIconOnly aria-label={workspaceOpen ? "收起产物侧栏" : "展开产物侧栏"} isDisabled={!activeId} onPress={() => setWorkspaceOpen((open) => !open)}>
                {workspaceOpen ? <ArrowChevronRight /> : <ArrowChevronLeft />}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>{workspaceOpen ? "收起产物侧栏" : "展开产物侧栏"}</Tooltip.Content>
          </Tooltip>
        </div>
      }
    >
      <main className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 space-x-2">
          <Card>
            <Card.Content>
              <MySurface className="mb-2 flex items-center justify-between gap-3 px-4 py-2">
                <div className="flex items-center justify-between gap-3">
                  <h1 className="text-lg font-bold">
                    {agents.find((x) => x.id === selectedAgentId)?.name ?? ""}
                  </h1>
                </div>
              </MySurface>
              <div className="flex space-x-2">
                <div className="left w-[60px]">
                  <ScrollShadow className="h-full">
                    <div className="space-y-2">
                      {agents.map((agent) => (
                        <AgentEmployeeCard
                          key={agent.id}
                          employee={agent}
                          selected={agent.id === selectedAgentId}
                          disabled={loading}
                          onSelect={() => selectAgent(agent.id)}
                        />
                      ))}
                    </div>
                  </ScrollShadow>
                </div>
                <MySurface className="right w-[200px] p-2">
                  <ScrollShadow className="h-full">
                    <div
                      className=" flex-col space-y-1"
                      role="list"
                      aria-label="会话列表"
                    >
                      {visibleSessions.map((session) => (
                        <SessionItem
                          key={session.id}
                          session={session}
                          selected={session.id === activeId}
                          disabled={loading}
                          runStatus={sessionRunStates[session.id]}
                          editing={session.id === editingSessionId}
                          editTitle={editingSessionTitle}
                          onEditStart={() => {
                            setEditingSessionId(session.id);
                            setEditingSessionTitle(session.title || "新对话");
                          }}
                          onEditTitleChange={setEditingSessionTitle}
                          onEditCancel={() => {
                            setEditingSessionId(null);
                            setEditingSessionTitle("");
                          }}
                          onSelect={() => void selectSession(session.id)}
                          onDelete={() =>
                            void deleteAgentSessionData(session.id).then(() => {
                              setSessions((x) =>
                                x.filter((item) => item.id !== session.id),
                              );
                              if (editingSessionId === session.id) {
                                setEditingSessionId(null);
                                setEditingSessionTitle("");
                              }
                              if (activeId === session.id) newSession();
                            })
                          }
                          onRename={(title) =>
                            updateAgentSessionData(session.id, { title }).then(
                              (updated) => {
                                setSessions((x) =>
                                  x.map((item) =>
                                    item.id === updated.id ? updated : item,
                                  ),
                                );
                                setEditingSessionId(null);
                                setEditingSessionTitle("");
                              },
                            )
                          }
                        />
                      ))}
                    </div>
                  </ScrollShadow>
                </MySurface>
              </div>
            </Card.Content>
          </Card>

          <div className="flex min-w-0 min-h-0 flex-1 gap-3">
            <div className="flex min-w-0 min-h-0 flex-1 flex-col gap-2">
              <Card className="flex min-w-0 min-h-0 flex-1 flex-col">
                <Card.Content className="min-h-0 flex-1">
                  <ScrollShadow className="h-full">
                    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-3 py-3">
                      {messages.length ? (
                        messages.map((message) => (
                          <AgentMessageView
                            key={message.id}
                            message={message}
                            loading={
                              (loading || activeRun) && message.id === runningAssistantId
                            }
                            runStatus={
                              message.id === runningAssistantId ||
                              (!activeRun && message.id === lastAssistantMessageId)
                                ? sessionRunStates[activeId ?? ""]
                                : undefined
                            }
                          />
                        ))
                      ) : (
                        <div className="flex min-h-64 items-center justify-center gap-3">
                          <FaceRobot />
                          <p>
                            {agents.length
                              ? "告诉 Agent 你想了解什么。"
                              : "暂无可用 AI 员工"}
                          </p>
                        </div>
                      )}
                      <div ref={endRef} />
                    </div>
                  </ScrollShadow>
                </Card.Content>
                <Card.Footer>
                  <div className="mx-auto w-full max-w-5xl">
                    {activeRun ? (
                      <div className="mb-2 flex justify-end">
                        <Tooltip>
                          <Tooltip.Trigger>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              aria-label="停止生成"
                              onPress={() => void stopActiveRun()}
                            >
                              <CircleStop />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>停止生成</Tooltip.Content>
                        </Tooltip>
                      </div>
                    ) : null}
                    <AgentMessageComposer
                      value={input}
                      loading={loading || activeRun || !agents.length}
                      error={error}
                      onChange={setInput}
                      onSend={() => void send()}
                      files={pendingFiles}
                      onFilesSelect={(selected) => void upload(selected)}
                      onFileRemove={(key) =>
                        setPendingFiles((items) =>
                          items.filter((item) => item.key !== key),
                        )
                      }
                    />
                  </div>
                </Card.Footer>
              </Card>
            </div>

            {workspaceOpen ? <div className="w-80 min-h-0 shrink-0">
              <WorkspaceFiles
                sessionId={activeId}
                outputFiles={artifacts}
              />
            </div> : null}
          </div>
        </div>
      </main>
    </PageContentLayout>
  );
}

async function fileFingerprint(file: File) {
  // Web Crypto is unavailable on non-secure origins (common for self-hosted
  // HTTP deployments). Keep content hashing where available and fall back to
  // a stable file identity so selecting the same file still de-duplicates.
  const browserCrypto = globalThis.crypto;
  if (typeof browserCrypto?.subtle?.digest === "function") {
    const digest = await browserCrypto.subtle.digest(
      "SHA-256",
      await file.arrayBuffer(),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }

  return [file.name, file.size, file.lastModified].join(":");
}

function applyDshEvent(
  event: Extract<AgentSseEvent, { type: "dsh.session.event" }>["event"],
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<AgentMessage[]>>,
): AgentRunStatus | undefined {
  if (event.type === "approval/asked") {
    const approvalId = typeof event.data.id === "string" ? event.data.id : "";
    if (!approvalId) return;
    setMessages((current) =>
      current.map((item) =>
        item.id === assistantId
          ? {
              ...item,
              approval: {
                approvalId,
                sessionId: item.sessionId ?? "",
                toolName: String(event.data.toolName ?? "yaya_propose_write"),
                reason:
                  typeof event.data.reason === "string"
                    ? event.data.reason
                    : undefined,
              },
            }
          : item,
      ),
    );
    return "working";
  }
  if (event.type === "tool/call") {
    const callId =
      typeof event.data.callId === "string"
        ? event.data.callId
        : createRandomUuid();
    const activity: AgentToolActivity = {
      id: callId,
      name: String(event.data.name ?? "工具"),
      status: "running",
      arguments: event.data.arguments,
    };
    setMessages((current) =>
      current.map((item) =>
        item.id === assistantId
          ? {
              ...item,
              toolActivities: [...(item.toolActivities ?? []), activity],
              timeline: [
                ...(item.timeline ?? []),
                { id: `tool-${callId}`, type: "tool", activity },
              ],
            }
          : item,
      ),
    );
    return "working";
  }
  if (event.type === "tool/result") {
    const message = event.data.message as Record<string, unknown> | undefined;
    const source = message?.source as Record<string, unknown> | undefined;
    const callId =
      typeof source?.callId === "string" ? source.callId : undefined;
    if (!callId) return "working";
    setMessages((current) =>
      current.map((item) => {
        if (item.id !== assistantId) return item;
        const update = (activity: AgentToolActivity) =>
          activity.id === callId
            ? {
                ...activity,
                status: "completed" as const,
                result: message?.content,
                ...(event.data.error === undefined
                  ? {}
                  : { error: event.data.error }),
              }
            : activity;
        return {
          ...item,
          toolActivities: item.toolActivities?.map(update),
          timeline: item.timeline?.map((block) =>
            block.type === "tool"
              ? { ...block, activity: update(block.activity) }
              : block,
          ),
        };
      }),
    );
    return "working";
  }
  if (event.type === "turn/end") {
    const reason = event.data.reason as Record<string, unknown> | undefined;
    if (reason?.kind === "aborted" || reason?.kind === "interrupted") return "stopped";
    if (reason?.kind === "completed") return "completed";
    return "failed";
  }
  if (event.type !== "assistant/chunk") return undefined;
  const chunk = event.data.chunk as Record<string, unknown> | undefined;
  const text = typeof chunk?.text === "string" ? chunk.text : "";
  if (!text) return undefined;
  const type = chunk?.type === "reasoning-delta" ? "reasoning" : "answer";
  setMessages((current) =>
    current.map((item) => {
      if (item.id !== assistantId) return item;
      const timeline = [...(item.timeline ?? [])];
      const last = timeline[timeline.length - 1];
      if (last?.type === type && "text" in last)
        timeline[timeline.length - 1] = { ...last, text: last.text + text };
      else
        timeline.push({
          id: createRandomUuid(),
          type,
          text,
        } as AgentTimelineItem);
      return {
        ...item,
        content: item.content + (type === "answer" ? text : ""),
        reasoning: (item.reasoning ?? "") + (type === "reasoning" ? text : ""),
        timeline,
      };
    }),
  );
  return type === "reasoning" ? "thinking" : "responding";
}

function isActiveRun(status: AgentRunStatus | undefined) {
  return status === "thinking" || status === "working" || status === "responding";
}

function toAgentRunStatus(status: "running" | "completed" | "failed" | "stopped" | "idle"): AgentRunStatus | undefined {
  if (status === "running") return "thinking";
  return status === "idle" ? undefined : status;
}

function primaryArtifacts<T extends { name: string }>(files: T[]) {
  const priority = /报价|quote|final|report|结果|result|交付|deliverable/i;
  const document = /\.(xlsx|xls|csv|pdf|docx?|pptx?|zip)$/i;
  const prioritized = files.filter((file) => priority.test(file.name));
  const candidates = prioritized.length ? prioritized : files.filter((file) => document.test(file.name));
  return (candidates.length ? candidates : files).slice(0, 3);
}
