"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { archiveAgentSession, fetchAgentWorkbenchSessions, type AgentWorkbenchDirectoryFilter, type AgentWorkbenchSession } from "@/features/agent-workbench/platform-api";
import { createClientCommandId, YayaMuxTransport, YayaWorkbenchApiClient, type ConnectionState, type DshEvent, type MuxFrame } from "@yaya/dsh-workbench-client";
import { createInitialSessionState, mergeHistory, reduceSessionFrame, setConnectionState, type SessionState } from "./runtime-core";

type HistoryEntry = { event?: DshEvent };
export type DirectoryFilter = Omit<AgentWorkbenchDirectoryFilter, "cursor">;
export type LocalConversationDraft = { agentId: string; draft: string; submitting: boolean; error?: string };

function useRuntimeStore() {
  const client = useRef<YayaWorkbenchApiClient | null>(null); if (!client.current) client.current = new YayaWorkbenchApiClient();
  const [sessions, setSessions] = useState<AgentWorkbenchSession[]>([]); const [activeId, setActiveId] = useState<string | null>(null); const [activeDraftAgentId, setActiveDraftAgentId] = useState<string | null>(null); const [drafts, setDrafts] = useState<Record<string, LocalConversationDraft>>({}); const [states, setStates] = useState<Record<string, SessionState>>({}); const [error, setError] = useState<string | null>(null);
  const [directoryFilter, setDirectoryFilterState] = useState<DirectoryFilter>({}); const [directoryCursor, setDirectoryCursor] = useState<string | undefined>(); const [directoryLoading, setDirectoryLoading] = useState(false);
  const statesRef = useRef(states); statesRef.current = states; const activeRef = useRef(activeId); activeRef.current = activeId;
  const loadDirectory = useCallback(async (filter: DirectoryFilter, cursor?: string) => {
    setDirectoryLoading(true);
    try {
      const page = await fetchAgentWorkbenchSessions({ ...filter, cursor });
      setSessions(current => {
        const items = cursor ? [...current, ...page.items.filter(item => !current.some(existing => existing.id === item.id))] : page.items;
        return items;
      });
      setStates(current => {
        const next = { ...current };
      for (const item of page.items) next[item.id] ??= createInitialSessionState(item);
        return next;
      });
      setDirectoryCursor(page.nextCursor);
    } finally { setDirectoryLoading(false); }
  }, []);
  const refreshDirectory = useCallback(async () => loadDirectory(directoryFilter), [directoryFilter, loadDirectory]);
  const setDirectoryFilter = useCallback(async (filter: DirectoryFilter) => { setDirectoryFilterState(filter); await loadDirectory(filter); }, [loadDirectory]);
  const loadMoreDirectory = useCallback(async () => { if (!directoryCursor || directoryLoading) return; await loadDirectory(directoryFilter, directoryCursor); }, [directoryCursor, directoryFilter, directoryLoading, loadDirectory]);
 const loadHistory = useCallback(async (sessionId: string, reset = false, older = false) => { const prior = statesRef.current[sessionId]; if (!prior || (older && (!prior.historyHasMore || prior.historyLoading))) return; setStates(current => current[sessionId] ? { ...current, [sessionId]: { ...current[sessionId], historyLoading: true } } : current); try { const page = await client.current!.history<{ events: HistoryEntry[]; hasMore?: boolean }>({ sessionId, maxMessages: 40, ...(older && prior.oldestSeq !== null ? { beforeSeq: prior.oldestSeq } : {}) }); const events = page.events.flatMap(item => item.event ? [item.event] : []); setStates(current => { const state = current[sessionId]; if (!state) return current; const next = mergeHistory(state, sessionId, events, reset ? "reset" : older ? "prepend" : "append"); return { ...current, [sessionId]: { ...next, historyLoading: false, historyHasMore: Boolean(page.hasMore), unread: activeRef.current === sessionId ? false : next.unread } }; }); } catch (reason) { setStates(current => current[sessionId] ? { ...current, [sessionId]: { ...current[sessionId], historyLoading: false } } : current); throw reason; } }, []);
  const selectSession = useCallback(async (sessionId: string) => { setActiveDraftAgentId(null); setActiveId(sessionId); setError(null); if (!statesRef.current[sessionId]?.canonicalEvents.length) await loadHistory(sessionId); setStates(current => current[sessionId] ? { ...current, [sessionId]: { ...current[sessionId], unread: false } } : current); }, [loadHistory]);
  const applyFrame = useCallback((frame: MuxFrame) => { const sessionId = frame.sessionId; if (!sessionId) return; setStates(current => { const state = current[sessionId]; if (!state) return current; const reduced = reduceSessionFrame(state, sessionId, frame, activeRef.current === sessionId); if (reduced.effect) void loadHistory(sessionId, reduced.effect.kind === "generation-reset"); return { ...current, [sessionId]: reduced.state }; }); }, [loadHistory]);
  useEffect(() => { void loadDirectory({}).catch(reason => setError(reason instanceof Error ? reason.message : "无法加载会话目录")); }, [loadDirectory]);
  useEffect(() => { const transport = new YayaMuxTransport(applyFrame, connection => setStates(current => Object.fromEntries(Object.entries(current).map(([id, value]) => [id, setConnectionState(value, connection)])))); transport.start(); return () => transport.stop(); }, [applyFrame]);
  const command = useCallback(async <T,>(sessionId: string, method: string, payload: Record<string, unknown>): Promise<T> => { const clientCommandId = createClientCommandId(); setStates(current => current[sessionId] ? { ...current, [sessionId]: { ...current[sessionId], command: { id: clientCommandId, method }, commandError: undefined } } : current); try { return await client.current!.rpc<T>(method, { sessionId, clientCommandId, ...payload }); } catch (reason) { const commandError = reason instanceof Error ? reason.message : "Agent 命令失败"; setStates(current => current[sessionId] ? { ...current, [sessionId]: { ...current[sessionId], commandError } } : current); throw reason; } finally { setStates(current => current[sessionId] ? { ...current, [sessionId]: { ...current[sessionId], command: undefined } } : current); } }, []);
  const create = useCallback(async (options: Record<string, unknown> = {}) => { const value = await client.current!.create<{ sessionId: string }>({ clientCommandId: createClientCommandId(), ...options }); setDirectoryFilterState({}); await loadDirectory({}); await selectSession(value.sessionId); return value.sessionId; }, [loadDirectory, selectSession]);
  const selectDraft = useCallback((agentId: string) => { setDrafts(current => current[agentId] ? current : { ...current, [agentId]: { agentId, draft: "", submitting: false } }); setActiveId(null); setActiveDraftAgentId(agentId); setError(null); }, []);
  const setLocalDraft = useCallback((agentId: string, draft: string) => setDrafts(current => ({ ...current, [agentId]: { ...(current[agentId] ?? { agentId, submitting: false }), draft, error: undefined } })), []);
  const submitDraft = useCallback(async (agentId: string, value?: string) => {
    const currentDraft = drafts[agentId]; const text = (value ?? currentDraft?.draft ?? "").trim();
    if (!text || currentDraft?.submitting) return;
    setDrafts(current => ({ ...current, [agentId]: { ...(current[agentId] ?? { agentId, draft: text }), draft: text, submitting: true, error: undefined } }));
    let sessionId: string | undefined;
    try {
      const created = await client.current!.create<{ sessionId: string }>({ clientCommandId: createClientCommandId(), agentId });
      sessionId = created.sessionId;
      await client.current!.rpc("session.prompt", { sessionId, clientCommandId: createClientCommandId(), mode: "queue", content: [{ type: "text", text }] });
      // A new YaYa conversation has no user-managed title.  Commit a compact
      // representation of its first accepted prompt through DSH so its title
      // event and the Rust directory stay in sync.
      try {
        await client.current!.rpc("session.rename", { sessionId, clientCommandId: createClientCommandId(), title: titleFromFirstPrompt(text) });
      } catch (titleError) {
        // The prompt is already durable. A title reconciliation retry must
        // never turn a valid first message into a failed draft or archive it.
        setError(titleError instanceof Error ? titleError.message : "会话标题同步失败");
      }
      await loadDirectory({ agentId });
      setDrafts(current => { const next = { ...current }; delete next[agentId]; return next; });
      await selectSession(sessionId);
    } catch (reason) {
      if (sessionId) {
        void client.current!.rpc("session.cancel", { sessionId, clientCommandId: createClientCommandId() })
          .catch(() => undefined)
          .finally(() => { void archiveAgentSession(sessionId!).catch(() => undefined); });
      }
      const message = reason instanceof Error ? reason.message : "无法创建会话";
      setDrafts(current => ({ ...current, [agentId]: { ...(current[agentId] ?? { agentId, draft: text }), draft: text, submitting: false, error: message } }));
      setError(message);
      throw reason;
    }
  }, [drafts, loadDirectory, selectSession]);
  const archive = useCallback(async (sessionId: string) => { await archiveAgentSession(sessionId); setSessions(current => current.filter(session => session.id !== sessionId)); setStates(current => { const next = { ...current }; delete next[sessionId]; return next; }); if (activeRef.current === sessionId) { setActiveId(null); } }, []);
  const cancel = useCallback(async (sessionId: string) => {
    await command(sessionId, "session.cancel", {});
    // DSH emits the authoritative turn/end shortly after accepting a cancel.
    // Reflect acceptance immediately so the composer does not look stuck;
    // history/mux will replace this with the canonical terminal event.
    setStates(current => current[sessionId] ? { ...current, [sessionId]: { ...current[sessionId], runStatus: "stopped", phase: "idle", commandError: undefined } } : current);
    void loadHistory(sessionId).catch(() => undefined);
  }, [command, loadHistory]);
  const rename = useCallback(async (sessionId: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) throw new Error("会话名称不能为空");
    await command(sessionId, "session.rename", { title: nextTitle });
    // The DSH title event is the durable source of truth. Apply the accepted
    // value locally as well so filtering and the directory update immediately.
    setSessions(current => current.map(session => session.id === sessionId ? { ...session, title: nextTitle } : session));
  }, [command]);
  return useMemo(() => ({ sessions, activeId, activeDraftAgentId, drafts, states, error, setError, refreshDirectory, directoryFilter, setDirectoryFilter, directoryLoading, directoryHasMore: Boolean(directoryCursor), loadMoreDirectory, selectSession, selectDraft, loadMore: (id: string) => loadHistory(id, false, true), create, submitDraft, prompt: (id: string, value: string) => command(id, "session.prompt", { mode: "queue", content: [{ type: "text", text: value }] }), promptContent: (id: string, content: unknown[]) => command(id, "session.prompt", { mode: "queue", content }), steer: (id: string, value: string) => command(id, "session.prompt", { mode: "steer", content: [{ type: "text", text: value }] }), selectModel: (id: string, routeId: string, model: string) => command(id, "session.selectModel", { routeId, model }), updateQueue: (id: string, queue: unknown[]) => command(id, "session.updateQueue", { queue }), cancel, archive, rename, fork: (id: string) => command<{ sessionId: string }>(id, "session.fork", {}), respond: (id: string, payload: Record<string, unknown>) => command(id, "respond", payload), subagent: (id: string, method: "list" | "history" | "prompt" | "interrupt", payload: Record<string, unknown> = {}) => command(id, `subagent.${method}`, payload), setDraft: (id: string, draft: string) => setStates(current => current[id] ? { ...current, [id]: { ...current[id], draft } } : current), setLocalDraft }), [sessions, activeId, activeDraftAgentId, drafts, states, error, refreshDirectory, directoryFilter, setDirectoryFilter, directoryLoading, directoryCursor, loadMoreDirectory, selectSession, selectDraft, loadHistory, create, submitDraft, command, cancel, archive, rename, setLocalDraft]);
}

function titleFromFirstPrompt(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  return characters.length > 48 ? `${characters.slice(0, 48).join("")}…` : normalized;
}

export type AgentWorkbenchRuntime = ReturnType<typeof useRuntimeStore>;
const RuntimeContext = createContext<AgentWorkbenchRuntime | null>(null);
export function AgentWorkbenchRuntimeProvider({ children }: { children: React.ReactNode }) { const runtime = useRuntimeStore(); return createElement(RuntimeContext.Provider, { value: runtime }, children); }
export function useAgentWorkbenchRuntime(): AgentWorkbenchRuntime { const runtime = useContext(RuntimeContext); if (!runtime) throw new Error("AgentWorkbenchRuntimeProvider is required in the protected application layout"); return runtime; }
