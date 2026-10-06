"use client";
import { notify } from "@lib/notify";

import { ArrowChevronLeft, ArrowChevronRight, Archive, CircleXmark, FaceRobot, Plus } from "@gravity-ui/icons";
import { Button, Card, Input, Modal, ScrollShadow, Tooltip } from "@heroui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageContentLayout } from "@components/PageContentLayout";
import { AgentMessage as AgentMessageView, AgentMessageComposer } from "@/features/agent-assistant/components";
import type { AgentOption } from "@/features/agent-assistant/types";
import { fetchAgentArtifacts, fetchAvailableAgents, type AgentFile } from "@/features/agent-workbench/platform-api";
import { AgentEmployeeCard, SessionItem, WorkspaceFiles } from "@/features/agent-workbench/components";
import { useAgentWorkbenchRuntime } from "@/features/agent-workbench/runtime";
import { MySurface } from "@shared/ui/MySurface";
import { listModelRoutes } from "@/features/settings/api";

export default function AgentPage() {
  const runtime = useAgentWorkbenchRuntime();
  const { setDirectoryFilter, setError } = runtime;
  const [employees, setEmployees] = useState<AgentOption[]>([]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [artifacts, setArtifacts] = useState<AgentFile[]>([]);
  const [renameSession, setRenameSession] = useState<{ id: string; title: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [modelOptions, setModelOptions] = useState<Array<{ routeId: string; model: string; label: string }>>([]);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, Record<string, { selected: string[]; custom: string }>>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const notifiedError = useRef<string | null>(null);
  const active = runtime.activeId ? runtime.states[runtime.activeId] : undefined;
  // request/header is canonical runtime data, not a UI projection node.  Showing
  // its model name here is safe and avoids exposing the internal provider route.
  const activeModelLabel = useMemo(() => modelFromCanonicalEvents(active?.canonicalEvents), [active?.canonicalEvents]);
  const localDraft = employeeId && runtime.activeDraftAgentId === employeeId ? runtime.drafts[employeeId] : undefined;
  const input = localDraft?.draft ?? active?.draft ?? "";
  const messages = active?.messages ?? [];
  const running = active?.runStatus === "thinking" || active?.runStatus === "working" || active?.runStatus === "responding";
  const sessions = useMemo(() => runtime.sessions.filter(item => item.agentId === employeeId && (!query.trim() || item.title.toLowerCase().includes(query.trim().toLowerCase()))), [runtime.sessions, employeeId, query]);
  const virtualizer = useVirtualizer({ count: sessions.length, getScrollElement: () => listRef.current, estimateSize: () => 56, overscan: 8 });

  useEffect(() => { void fetchAvailableAgents({ route: "/agent" }).then(items => { const next = items.filter(item => item.isAiEmployee); setEmployees(next); if (next[0]) setEmployeeId(value => value ?? next[0].id); }).catch(() => setError("无法加载 AI 员工")); }, [setError]);
  useEffect(() => { if (employeeId) void setDirectoryFilter({ agentId: employeeId }).catch(reason => setError(reason instanceof Error ? reason.message : "无法加载会话")); }, [employeeId, setDirectoryFilter, setError]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.at(-1)?.id]);
  useEffect(() => { if (!runtime.activeId) { setArtifacts([]); return; } void fetchAgentArtifacts(runtime.activeId).then(setArtifacts).catch(() => setArtifacts([])); }, [runtime.activeId, active?.lastSeq]);
  useEffect(() => { void listModelRoutes<Array<{ id: string; name: string; models: string[]; defaultChatModel: string; enabled: boolean }>>().then(routes => { setModelOptions(routes.filter(route => route.enabled).flatMap(route => [...new Set([...route.models, route.defaultChatModel])].filter(Boolean).map(model => ({ routeId: route.id, model, label: `${route.name} · ${model}` })))); }).catch(() => setModelOptions([])); }, []);
  useEffect(() => { const message = active?.commandError || localDraft?.error || runtime.error; if (message && message !== notifiedError.current) { notifiedError.current = message; notify.error("Agent 操作失败", { description: message }); } if (!message) notifiedError.current = null; }, [active?.commandError, localDraft?.error, runtime.error]);

  async function send() { const text = input.trim(); if (!text) return; try { if (localDraft && employeeId) await runtime.submitDraft(employeeId, text); else if (runtime.activeId) { runtime.setDraft(runtime.activeId, ""); await runtime.prompt(runtime.activeId, text); } } catch {} }
  async function archive(id: string) { if (!window.confirm("归档后该会话将从当前列表移除。确定归档吗？")) return; try { await runtime.archive(id); if (employeeId) runtime.selectDraft(employeeId); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法归档会话"); } }
  function openRename(session: { id: string; title: string }) { setRenameSession(session); setRenameValue(session.title); }
  async function rename() { if (!renameSession || !renameValue.trim()) return; setRenaming(true); try { await runtime.rename(renameSession.id, renameValue); setRenameSession(null); notify.success("会话已重命名"); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法重命名会话"); } finally { setRenaming(false); } }
  function submitQuestion(frame: { rpcId: string; questions: QuestionItem[]; skip?: boolean }) {
    if (!runtime.activeId) return;
    const drafts = questionDrafts[frame.rpcId] ?? {};
    const skipped = frame.skip === true || frame.questions.every(question => Array.isArray(question.options) && question.options.length === 0);
    void runtime.respond(runtime.activeId, {
      rpcId: frame.rpcId,
      result: {
        ok: true,
        value: {
          sessionId: runtime.activeId,
          answer: {
            answers: frame.questions.map(question => ({
              id: question.id,
              selected: skipped ? [] : drafts[question.id]?.selected ?? [],
              ...(!skipped && drafts[question.id]?.custom?.trim() ? { custom: drafts[question.id].custom.trim() } : {}),
            })),
          },
        },
      },
    }).then(() => setQuestionDrafts(current => { const next = { ...current }; delete next[frame.rpcId]; return next; })).catch(reason => setError(reason instanceof Error ? reason.message : "提交确认失败"));
  }
  const currentAssistant = useMemo(() => [...messages].reverse().find(item => item.role === "assistant")?.id, [messages]);

  return <PageContentLayout title="Agent" subtitle="AI 员工工作台" actions={<div className="flex gap-1"><Tooltip><Tooltip.Trigger><Button isIconOnly aria-label="新会话" isDisabled={!employeeId} onPress={() => employeeId && runtime.selectDraft(employeeId)}><Plus /></Button></Tooltip.Trigger><Tooltip.Content>新会话</Tooltip.Content></Tooltip><Tooltip><Tooltip.Trigger><Button isIconOnly aria-label="产物侧栏" isDisabled={!runtime.activeId} onPress={() => setWorkspaceOpen(value => !value)}>{workspaceOpen ? <ArrowChevronRight /> : <ArrowChevronLeft />}</Button></Tooltip.Trigger><Tooltip.Content>{workspaceOpen ? "收起产物侧栏" : "展开产物侧栏"}</Tooltip.Content></Tooltip></div>}>
    <main className="flex h-full min-h-0"><div className="flex min-h-0 flex-1 gap-2">
      <Card className="w-24 shrink-0"><Card.Content className="min-h-0"><MySurface className="mb-2 px-2 py-2 text-center text-sm font-bold">员工</MySurface><ScrollShadow className="h-full"><div className="space-y-1">{employees.map(employee => <AgentEmployeeCard key={employee.id} employee={employee} selected={employee.id === employeeId} onSelect={() => { setEmployeeId(employee.id); setQuery(""); }} />)}</div></ScrollShadow></Card.Content></Card>
      <Card className="w-64 shrink-0"><Card.Content className="min-h-0"><MySurface className="mb-2 px-4 py-2"><h1 className="text-lg font-bold">会话</h1></MySurface><Input aria-label="搜索会话" value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder="搜索会话" className="mb-2" /><div ref={listRef} className="h-full overflow-auto" onScroll={event => { const target = event.currentTarget; if (target.scrollHeight - target.scrollTop - target.clientHeight < 160 && runtime.directoryHasMore) void runtime.loadMoreDirectory(); }}><div className="relative" style={{ height: virtualizer.getTotalSize() }}>{virtualizer.getVirtualItems().map(row => { const session = sessions[row.index]; return <div key={session.id} ref={virtualizer.measureElement} data-index={row.index} className="absolute left-0 top-0 w-full pb-1" style={{ transform: `translateY(${row.start}px)` }}><SessionItem session={session} selected={session.id === runtime.activeId} runStatus={runtime.states[session.id]?.runStatus} phase={runtime.states[session.id]?.phase || session.phase} unread={runtime.states[session.id]?.unread} pendingApprovalCount={runtime.states[session.id]?.pendingApprovalCount} lastToolName={runtime.states[session.id]?.lastToolName || session.lastToolName} onSelect={() => void runtime.selectSession(session.id)} onRename={() => openRename(session)} onArchive={() => void archive(session.id)} /></div>; })}</div></div></Card.Content></Card>
      <div className="flex min-w-0 min-h-0 flex-1 gap-3"><Card className="flex min-w-0 min-h-0 flex-1 flex-col"><Card.Content className="min-h-0 flex-1"><ScrollShadow className="h-full"><div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-3 py-3">{active?.historyHasMore ? <Button size="sm" variant="ghost" className="self-start" isDisabled={active.historyLoading} onPress={() => runtime.loadMore(runtime.activeId!)}>{active.historyLoading ? "加载中..." : "加载更早消息"}</Button> : null}{active?.queue.length ? <div className="rounded-lg border border-default-200 bg-default-50 p-3"><strong className="text-sm">待发送消息</strong>{active.queue.map((item, index) => <div key={`${index}:${JSON.stringify(item)}`} className="mt-1 flex items-center rounded-md bg-background px-2 py-1 text-sm"><span className="min-w-0 flex-1 truncate">{typeof item === "string" ? item : JSON.stringify(item)}</span><Button isIconOnly size="sm" variant="ghost" aria-label="删除待发送消息" onPress={() => void runtime.updateQueue(runtime.activeId!, active.queue.filter((_, itemIndex) => itemIndex !== index))}><CircleXmark /></Button></div>)}</div> : null}{active?.questions.map(raw => { const frame = raw as unknown as QuestionFrame; return frame.rpcId && frame.questions?.length ? <QuestionCard key={frame.rpcId} frame={frame} drafts={questionDrafts[frame.rpcId] ?? {}} disabled={Boolean(active.command)} onChange={(questionId, value) => setQuestionDrafts(current => ({ ...current, [frame.rpcId]: { ...(current[frame.rpcId] ?? {}), [questionId]: value } }))} onSubmit={() => submitQuestion(frame)} onSkip={() => submitQuestion({ ...frame, questions: frame.questions.map(question => ({ ...question, options: [] })) })} /> : null; })}{messages.length ? messages.map(message => <AgentMessageView key={message.id} message={message} loading={running && message.id === currentAssistant} runStatus={message.id === currentAssistant ? active?.runStatus : undefined} />) : <div className="flex min-h-64 items-center justify-center gap-3"><FaceRobot /><p>{localDraft ? "发送第一条消息，开始新的协作。" : "从左侧选择 AI 员工后新建会话，或打开已有会话。"}</p></div>}<div ref={endRef} /></div></ScrollShadow></Card.Content><Card.Footer><div className="mx-auto w-full max-w-5xl"><AgentMessageComposer value={input} loading={Boolean(active?.command) || Boolean(localDraft?.submitting)} running={running} onCancel={() => runtime.activeId && void runtime.cancel(runtime.activeId)} modelLabel={activeModelLabel} modelOptions={modelOptions} onModelSelect={option => runtime.activeId && void runtime.selectModel(runtime.activeId, option.routeId, option.model)} onChange={value => localDraft && employeeId ? runtime.setLocalDraft(employeeId, value) : runtime.activeId && runtime.setDraft(runtime.activeId, value)} onSend={() => void send()} /></div></Card.Footer></Card>{workspaceOpen ? <div className="w-80 min-h-0 shrink-0"><WorkspaceFiles sessionId={runtime.activeId} outputFiles={artifacts} /></div> : null}</div>
    </div></main>
    <Modal isOpen={renameSession !== null} onOpenChange={(open) => !open && !renaming && setRenameSession(null)}><Modal.Backdrop isDismissable={!renaming}><Modal.Container placement="center" size="sm"><Modal.Dialog><Modal.Header><Modal.Heading>重命名会话</Modal.Heading></Modal.Header><Modal.Body><Input aria-label="会话名称" autoFocus value={renameValue} onChange={event => setRenameValue(event.currentTarget.value)} onKeyDown={event => { if (event.key === "Enter") void rename(); }} placeholder="请输入会话名称" /></Modal.Body><Modal.Footer><Button variant="ghost" isDisabled={renaming} onPress={() => setRenameSession(null)}>取消</Button><Button isPending={renaming} isDisabled={renaming || !renameValue.trim()} onPress={() => void rename()}>保存</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
  </PageContentLayout>;
}

function modelFromCanonicalEvents(events: readonly { type: string; data: Record<string, unknown> }[] | undefined) {
  for (const event of [...(events ?? [])].reverse()) {
    if (event.type !== "request/header") continue;
    const header = event.data.header as { config?: { model?: unknown } } | undefined;
    if (typeof header?.config?.model === "string" && header.config.model.trim()) return header.config.model;
  }
  return "模型由 AI 员工配置";
}

type QuestionOption = { label: string; description?: string };
type QuestionItem = { id: string; question: string; detail?: string; header?: string; options?: QuestionOption[]; multiSelect?: boolean; intent?: { kind?: string; approve?: string } };
type QuestionFrame = { rpcId: string; questions: QuestionItem[] };

function QuestionCard({ frame, drafts, disabled, onChange, onSubmit, onSkip }: { frame: QuestionFrame; drafts: Record<string, { selected: string[]; custom: string }>; disabled: boolean; onChange: (id: string, value: { selected: string[]; custom: string }) => void; onSubmit: () => void; onSkip: () => void }) {
  return <div className="rounded-2xl border border-default-200 bg-default-50 p-4 shadow-sm" role="dialog" aria-label="Agent 确认问题">
    <div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-medium text-muted">Agent 需要确认</p><h2 className="mt-1 text-sm font-semibold">请确认以下选项后继续</h2></div><span className="text-xs text-muted">{frame.questions.length} 个问题</span></div>
    <div className="space-y-4">{frame.questions.map(question => { const value = drafts[question.id] ?? { selected: [], custom: "" }; const options = question.options ?? []; const setSelected = (label: string, checked: boolean) => { const selected = question.multiSelect ? (checked ? [...new Set([...value.selected, label])] : value.selected.filter(item => item !== label)) : checked ? [label] : []; onChange(question.id, { ...value, selected }); }; return <fieldset key={question.id} className="space-y-2"><legend className="text-sm font-medium">{question.header ? `${question.header}：` : ""}{question.question}</legend>{question.detail ? <p className="text-xs leading-5 text-muted">{question.detail}</p> : null}<div className="space-y-2">{options.map(option => <label key={option.label} className="flex cursor-pointer items-start gap-2 rounded-lg border border-default-200 bg-background px-3 py-2 hover:bg-default-100"><input className="mt-1" type={question.multiSelect ? "checkbox" : "radio"} name={`${frame.rpcId}:${question.id}`} checked={value.selected.includes(option.label)} onChange={event => setSelected(option.label, event.currentTarget.checked)} /><span className="min-w-0"><span className="block text-sm">{option.label}</span>{option.description ? <span className="block text-xs text-muted">{option.description}</span> : null}</span></label>)}</div><Input aria-label={`${question.question} 的其他回答`} value={value.custom} onChange={event => onChange(question.id, { ...value, custom: event.currentTarget.value })} placeholder="其他（可选）" /></fieldset>})}</div>
    <div className="mt-4 flex justify-end gap-2"><Button size="sm" variant="ghost" isDisabled={disabled} onPress={onSkip}>跳过本题</Button><Button size="sm" variant="primary" isDisabled={disabled} onPress={onSubmit}>提交</Button></div>
  </div>;
}
