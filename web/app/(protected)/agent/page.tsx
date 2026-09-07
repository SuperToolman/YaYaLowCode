"use client";

import { FaceRobot, Plus } from "@gravity-ui/icons";
import { Button, Card, ScrollShadow } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { agentFileDownloadUrl, createAgentSessionData, deleteAgentSessionData, fetchAgentArtifacts, fetchAgentFiles, fetchAgentMessages, fetchAgentSessions, fetchAvailableAgents, openAgentMessageStream, uploadAgentFile, updateAgentSessionData, type AgentFile } from "@/features/agent-assistant/api";
import { parseAgentSseFrame } from "@/features/agent-assistant/sse";
import type { AgentMessage, AgentOption, AgentPageContext, AgentSession, AgentSseEvent, AgentTimelineItem } from "@/features/agent-assistant/types";
import { PageContentLayout } from "../../components/page-content-layout";
import { AgentMessage as AgentMessageView } from "../../components/agent-message";
import { SessionItem } from "./components/SessionItem";
import { AgentEmployeeCard } from "./components/AgentEmployeeCard";
import { AgentMessageComposer } from "../../components/agent-message-composer";
import { createRandomUuid } from "@/app/lib/random-uuid";

const pageContext: AgentPageContext = { route: "/agent" };

export default function AgentPage() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("cordis-default");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<AgentFile[]>([]); const [artifacts, setArtifacts] = useState<AgentFile[]>([]);
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; key: string }>>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const visibleSessions = useMemo(() => sessions.filter((session) => session.agentId === selectedAgentId), [sessions, selectedAgentId]);

  useEffect(() => { void (async () => { try { const [a, s] = await Promise.all([fetchAvailableAgents(pageContext), fetchAgentSessions()]); setAgents(a); setSessions(s.filter((x) => a.some((y) => y.id === x.agentId))); if (a[0]) setSelectedAgentId(a[0].id); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法加载 Agent"); } })(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  async function selectSession(id: string) { setActiveId(id); setError(null); try { const [history, sessionFiles, outputs] = await Promise.all([fetchAgentMessages(id), fetchAgentFiles(id), fetchAgentArtifacts(id)]); const resolved = history.map((message) => ({ ...message, files: message.files?.map((file) => sessionFiles.find((item) => item.id === file.id) ?? file) })); const lastAssistant = [...resolved].reverse().findIndex((message) => message.role === "assistant"); if (lastAssistant >= 0 && outputs.length) { const index = resolved.length - 1 - lastAssistant; resolved[index] = { ...resolved[index], sessionId: id, files: outputs }; } setMessages(resolved); setFiles(sessionFiles); setArtifacts(outputs); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法加载消息"); } }
  function newSession() { setActiveId(null); setMessages([]); setFiles([]); setArtifacts([]); setPendingFiles([]); setError(null); }
  async function upload(selectedFiles: File[]) {
    if (!agents.some((agent) => agent.id === selectedAgentId)) { setError("当前没有可用的 AI 员工"); return; }
    const invalid = selectedFiles.find((file) => file.size === 0 || file.size > 50 * 1024 * 1024);
    if (invalid) { setError("文件大小必须在 1B 到 50MB 之间"); return; }
    const candidates = await Promise.all(selectedFiles.map(async (file) => ({ file, key: await fileFingerprint(file) })));
    const duplicate = candidates.some((candidate, index) => files.some((item) => item.checksum === candidate.key) || pendingFiles.some((item) => item.key === candidate.key) || candidates.findIndex((item) => item.key === candidate.key) !== index);
    if (duplicate) return;
    setError(null); setPendingFiles((items) => [...items, ...candidates.filter((candidate) => !items.some((item) => item.key === candidate.key))]);
  }
  function selectAgent(id: string) { setSelectedAgentId(id); const session = sessions.find((x) => x.agentId === id); if (session) void selectSession(session.id); else newSession(); }
  async function send() {
    const content = input.trim(); if (!content || loading || !agents.some((x) => x.id === selectedAgentId)) return;
    setInput(""); setLoading(true); setError(null);
    try { let id = activeId; let createdForSend = false; if (!id) { const created = await createAgentSessionData(pageContext, selectedAgentId); id = created.id; createdForSend = true; setActiveId(id); setSessions((x) => [created, ...x]); const titled = await updateAgentSessionData(id, { title: content.slice(0, 80) }); setSessions((x) => x.map((item) => item.id === titled.id ? titled : item)); }
      let uploadedFiles: AgentFile[] = []; try { uploadedFiles = await Promise.all(pendingFiles.map(({ file }) => uploadAgentFile(id as string, file))); } catch (reason) { if (createdForSend && id) { await deleteAgentSessionData(id).catch(() => undefined); setSessions((items) => items.filter((item) => item.id !== id)); setActiveId(null); } throw reason; } setFiles((items) => [...items, ...uploadedFiles]); setPendingFiles([]);
      const assistantId = createRandomUuid(); setMessages((x) => [...x, { id: createRandomUuid(), sessionId: id, role: "user", content, files: uploadedFiles }, { id: assistantId, sessionId: id, role: "assistant", content: "" }]);
      const reader = (await openAgentMessageStream(id, content, pageContext, selectedAgentId, undefined, uploadedFiles.map((file) => file.id))).body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) { const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done }); if (chunk.done && buffer.trim()) buffer += "\n\n"; const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() ?? ""; for (const frame of frames) { const event = parseAgentSseFrame(frame); if (event?.type === "dsh.session.event") applyDshEvent(event.event, assistantId, setMessages); else if (event?.type === "artifact.created") { const artifact = { id: event.id, name: event.name, mimeType: event.mimeType ?? "application/octet-stream", size: event.size ?? 0, kind: "output" }; setArtifacts((items) => items.some((item) => item.id === event.id) ? items : [...items, artifact]); setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, sessionId: id as string, files: [...(item.files ?? []), artifact] } : item)); } else if (event?.type === "run.failed" || event?.type === "message.failed") throw new Error(event.message); } if (chunk.done) break; }
      window.dispatchEvent(new Event("yaya-apps-updated"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Agent 请求失败"); } finally { setLoading(false); }
  }
  return <PageContentLayout title="Agent" subtitle="AI 员工工作台" actions={<Button isIconOnly aria-label="新会话" isDisabled={loading || !agents.length} onPress={newSession}><Plus /></Button>}><main className="flex h-full min-h-0 flex-col"><div className="flex min-h-0 flex-1 space-x-2"><Card className="hidden w-24 shrink-0 sm:flex"><Card.Header><Card.Title>AI 员工</Card.Title></Card.Header><Card.Content><ScrollShadow className="h-full"><div className="space-y-2">{agents.map((agent) => <AgentEmployeeCard key={agent.id} employee={agent} selected={agent.id === selectedAgentId} disabled={loading} onSelect={() => selectAgent(agent.id)} />)}</div></ScrollShadow></Card.Content></Card><Card className="hidden w-60 shrink-0 sm:flex"><Card.Header><Card.Title>会话</Card.Title></Card.Header><Card.Content><ScrollShadow className="h-full"><div role="list" aria-label="会话列表">{visibleSessions.map((session) => <SessionItem key={session.id} session={session} selected={session.id === activeId} disabled={loading} onSelect={() => void selectSession(session.id)} onDelete={() => void (deleteAgentSessionData(session.id).then(() => { setSessions((x) => x.filter((item) => item.id !== session.id)); if (activeId === session.id) newSession(); }))} onRename={(title) => updateAgentSessionData(session.id, { title }).then((updated) => { setSessions((x) => x.map((item) => item.id === updated.id ? updated : item)); })} />)}</div></ScrollShadow></Card.Content></Card><Card className="flex min-w-0 min-h-0 flex-1 flex-col"><Card.Content className="min-h-0 flex-1"><ScrollShadow className="h-full"><div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-3 py-3">{messages.length ? messages.map((message) => <AgentMessageView key={message.id} message={message} loading={loading} />) : <div className="flex min-h-64 items-center justify-center gap-3"><FaceRobot /><p>{agents.length ? "告诉 Agent 你想了解什么。" : "暂无可用 AI 员工"}</p></div>}{artifacts.length ? <div className="border-t pt-2 text-xs">产物：{artifacts.map((file) => <a className="mr-3 underline" key={file.id} href={activeId ? agentFileDownloadUrl(activeId, file.id) : "#"} target="_blank">{file.name}</a>)}</div> : null}<div ref={endRef} /></div></ScrollShadow></Card.Content><Card.Footer><div className="mx-auto w-full max-w-5xl"><AgentMessageComposer value={input} loading={loading || !agents.length} error={error} onChange={setInput} onSend={() => void send()} files={pendingFiles} onFilesSelect={(selected) => void upload(selected)} onFileRemove={(key) => setPendingFiles((items) => items.filter((item) => item.key !== key))} /></div></Card.Footer></Card></div></main></PageContentLayout>;
}

async function fileFingerprint(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function applyDshEvent(event: Extract<AgentSseEvent, { type: "dsh.session.event" }>["event"], assistantId: string, setMessages: React.Dispatch<React.SetStateAction<AgentMessage[]>>) {
  if (event.type === "approval/asked") {
    const approvalId = typeof event.data.id === "string" ? event.data.id : "";
    if (!approvalId) return;
    setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, approval: { approvalId, sessionId: item.sessionId ?? "", toolName: String(event.data.toolName ?? "yaya_propose_write"), reason: typeof event.data.reason === "string" ? event.data.reason : undefined } } : item));
    return;
  }
  if (event.type !== "assistant/chunk") return;
  const chunk = event.data.chunk as Record<string, unknown> | undefined; const text = typeof chunk?.text === "string" ? chunk.text : ""; if (!text) return; const type = chunk?.type === "reasoning-delta" ? "reasoning" : "answer";
  setMessages((current) => current.map((item) => { if (item.id !== assistantId) return item; const timeline = [...(item.timeline ?? [])]; const last = timeline[timeline.length - 1]; if (last?.type === type && "text" in last) timeline[timeline.length - 1] = { ...last, text: last.text + text }; else timeline.push({ id: createRandomUuid(), type, text } as AgentTimelineItem); return { ...item, content: item.content + (type === "answer" ? text : ""), reasoning: (item.reasoning ?? "") + (type === "reasoning" ? text : ""), timeline }; }));
}
