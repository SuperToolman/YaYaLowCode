import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentEvent, Message, Session } from "@/features/agent-v2/client";
import * as api from "@/features/agent-v2/client";
import Page from "./page";
import { listBases } from "@/features/knowledge/client";
import { listModelRoutes } from "@/features/settings/api";
import { notify } from "@/shared/lib/notify";

vi.mock("@/shared/providers/ThemeProvider", () => ({ useTheme: () => ({ appearance: { surfaceVariant: "default" } }) }));
vi.mock("@/features/auth/components/AuthProvider", () => ({ useAuth: () => ({ user: { id: "viewer" }, permissionsReady: true, hasPermission: () => true }) }));
vi.mock("@/features/knowledge/client", async original => ({ ...await original<typeof import("@/features/knowledge/client")>(), listBases: vi.fn() }));
vi.mock("@/features/settings/api", async original => ({ ...await original<typeof import("@/features/settings/api")>(), listModelRoutes: vi.fn() }));
vi.mock("@/shared/lib/notify", () => ({ notify: { error: vi.fn() }, notifyRequestError: vi.fn() }));
vi.mock("@/shared/ui/PageContentLayout", () => ({ PageContentLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/features/agent-v2/client", async original => ({ ...await original<typeof api>(), listEmployees: vi.fn(), listSessions: vi.fn(), createSession: vi.fn(), listMessages: vi.fn(), listConfirmations: vi.fn(), submitCommand: vi.fn(), listWorkspaceFiles:vi.fn(), uploadWorkspaceFile:vi.fn(), createSubmission:vi.fn(),getSubmission:vi.fn(),commitSubmission:vi.fn(),abandonSubmission:vi.fn(),uploadStagedFile:vi.fn(),listFilePreviews:vi.fn(),readSession:vi.fn(),listExecutions:vi.fn() }));

class Events {
  static instances: Events[] = [];
  onmessage: ((frame: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, () => void>();
  close = vi.fn();
  constructor(readonly url: string) { Events.instances.push(this); }
  addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
  emit(frame: AgentEvent) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}
const session: Session = { id: "session-a", employee_id: "employee-a", title: "会话 A", engine: "v2", tenant_id: "t", owner_user_id: "u", next_seq: 0, created_at: "", updated_at: "", run_status: "completed" };
const message: Message = { id: "message-a", session_id: session.id, run_id: "run-a", role: "user", parts: [{ type: "text", text: "历史消息" }], created_at: "2026-11-10T10:00:00Z", run_status: "completed" };
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><Page /></QueryClientProvider>);
}
function setup() {
  vi.mocked(listBases).mockResolvedValue({ items: [] });
  vi.mocked(listModelRoutes).mockResolvedValue([{ id: "route", name: "测试模型", providerType: "chat", enabled: true, isDefault: true, model: "test-model", defaultReasoningEffort: "auto", apiBaseUrl: "https://models.example.com/v1", apiKeyConfigured: true }]);
  vi.mocked(api.readSession).mockImplementation(async id => ({ ...session, id }));
  vi.mocked(api.listExecutions).mockResolvedValue({ items: [] });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
  vi.stubGlobal("Image", class extends EventTarget {
    complete = true;
    naturalWidth = 32;
    src = "";
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("EventSource", Events);
  vi.mocked(api.listEmployees).mockResolvedValue({ items: [{ id: "employee-a", title: "员工 A", description: "" }] });
  vi.mocked(api.listSessions).mockResolvedValue({ items: [session] });
  vi.mocked(api.listConfirmations).mockResolvedValue({ items: [] });
  vi.mocked(api.listWorkspaceFiles).mockResolvedValue({items:[]});
  vi.mocked(api.listFilePreviews).mockResolvedValue({items:[]});
  const submissions=new Map<string,api.Submission>();
  vi.mocked(api.createSubmission).mockImplementation(async input=>{const value={id:input.clientRequestId,status:"uploading",expiresAt:"",payload:input,attachments:input.attachments.map(f=>({clientFileId:f.clientFileId,uploaded:false})),result:null};submissions.set(value.id,value);return value;});
  vi.mocked(api.getSubmission).mockImplementation(async id=>submissions.get(id)!);
  vi.mocked(api.uploadStagedFile).mockImplementation(async(id,fid)=>{const value=submissions.get(id)!;value.attachments=value.attachments.map(f=>({...f,uploaded:f.uploaded||f.clientFileId===fid}));return value;});
  vi.mocked(api.commitSubmission).mockImplementation(async id=>{const value=submissions.get(id)!;const result={sessionId:session.id,messageId:"message-a",commandId:"cmd",runId:"run-a"};const saved={...value,status:"committed",result};submissions.set(id,saved);return saved;});
  vi.mocked(api.abandonSubmission).mockImplementation(async id=>({...submissions.get(id)!,status:"abandoned"}));
  vi.mocked(api.listMessages).mockResolvedValue({ items: [message] });
  vi.mocked(api.submitCommand).mockResolvedValue({ commandId: "cmd", runId: "run-a" });
  vi.mocked(api.createSession).mockResolvedValue(session);
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetAllMocks(); localStorage.clear(); Events.instances = []; });

it("opens only the latest history page and explicitly prepends older turns without replaying the entire session",async()=>{
  setup();
  const answer:Message={...message,id:"answer",role:"assistant",created_at:"2026-11-10T10:02:00Z",run_status:"completed",parts:[{type:"text",text:"已经完成的回复"}]};
  const snapshot:AgentEvent[]=[{event_id:"old",session_id:session.id,run_id:message.run_id,seq:8,type:"message.delta",payload:{text:"过时片段"},protocol_version:1,created_at:""}];
  vi.mocked(api.listMessages).mockImplementation(async(_id,_signal,before)=>before ? {items:[{...message,id:"older",run_id:"older-run",run_status:"completed",parts:[{type:"text",text:"更早的内容"}]}],next_before:null,events:[]} : {items:[{...message,run_status:"completed"},answer],next_before:"21",event_cursor:10,events:snapshot});
  renderPage();fireEvent.click(await screen.findByText("会话 A"));
  await screen.findByText("已经完成的回复");
  expect(screen.queryByText("更早的内容")).toBeNull();
  expect(screen.getByText(/用时.*分钟（完成）/)).toBeTruthy();
  expect(screen.queryByText(/分钟（运行中）/)).toBeNull();
  expect(screen.queryByRole("button",{name:"停止执行"})).toBeNull();
  expect(Events.instances[0].url).toBe(`/api/agent/v2/sessions/${session.id}/events?after=10`);
  fireEvent.click(screen.getByRole("button",{name:"查看更早的消息"}));
  await screen.findByText("更早的内容");
  expect(api.listMessages).toHaveBeenCalledWith(session.id,undefined,"21");
  expect(screen.getByText("已经完成的回复")).toBeTruthy();
  expect(screen.queryByRole("button",{name:"查看更早的消息"})).toBeNull();
});

it("loads persistent history, retries the same submission and stops without disconnect cancellation", async()=>{
 setup();renderPage();fireEvent.click(await screen.findByText("会话 A"));await screen.findByText("历史消息");
 const source=Events.instances[0];act(()=>source.onopen?.());
 fireEvent.paste(screen.getByLabelText("发送给 AI 员工"),{clipboardData:{files:[],getData:()=>"hello"}});
 vi.mocked(api.commitSubmission).mockRejectedValueOnce(new Error("网络中断"));
 fireEvent.click(screen.getByRole("button",{name:"发送消息"}));await waitFor(()=>expect(notify.error).toHaveBeenCalledWith("网络中断"));
 vi.mocked(api.listMessages).mockResolvedValue({items:[{...message,run_status:"queued"}]});
 fireEvent.click(screen.getByRole("button",{name:"发送消息"}));
 await waitFor(()=>expect(api.commitSubmission).toHaveBeenCalledTimes(2));
 expect(vi.mocked(api.commitSubmission).mock.calls[0]).toEqual(vi.mocked(api.commitSubmission).mock.calls[1]);
 await waitFor(()=>expect((screen.getByLabelText("发送给 AI 员工") as HTMLElement).textContent).toBe(""));
 await screen.findByRole("button",{name:"停止执行"});
 act(()=>source.onerror?.());
 expect(source.close).not.toHaveBeenCalled();
 expect(api.submitCommand).not.toHaveBeenCalled();
 expect(screen.getByText("历史消息")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"停止执行"}));await waitFor(()=>expect(api.submitCommand).toHaveBeenCalledWith(session.id,expect.objectContaining({kind:"cancel"})));
 cleanup();expect(source.close).toHaveBeenCalled();
});

it("deduplicates SSE frames and removes data when access is revoked", async () => {
  setup(); renderPage();fireEvent.click(await screen.findByText("会话 A"));await screen.findByText("历史消息");
  const source=Events.instances[0];
  const frame: AgentEvent={event_id:"e",session_id:session.id,run_id:"run-a",seq:1,type:"tool.started",payload:{name:"diagnostic_echo",callId:"c"},protocol_version:1,created_at:""};
  act(()=>{source.emit(frame);source.emit(frame);});
  expect(screen.getAllByText(/工具执行中/)).toHaveLength(1);
  act(()=>source.listeners.get("access_revoked")?.());
  expect(screen.queryByText("历史消息")).toBeNull();
  expect(notify.error).toHaveBeenCalledWith("当前会话访问权限已失效");
});

it("renders employee avatars with HeroUI selection and creates from the icon button", async () => {
  setup();
  vi.mocked(api.listEmployees).mockResolvedValue({ items: [
    { id: "employee-a", title: "员工 A", description: "" },
    { id: "employee-b", title: "员工 B", description: "" },
  ] });
  renderPage();
  await screen.findByText("会话 A");
  const avatar = await screen.findByAltText("员工 A的头像");
  expect(avatar.getAttribute("src")).toBe("/api/ai-employees/employee-a/avatar");
  fireEvent.click(screen.getByRole("button", { name: /AI 员工/ }));
  fireEvent.click(await screen.findByRole("option", { name: /员工 B/ }));
  await waitFor(() => expect(screen.getAllByAltText("员工 B的头像")[0].getAttribute("src")).toBe("/api/ai-employees/employee-b/avatar"));
  expect(screen.queryByText("会话 A")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
  expect(api.createSession).not.toHaveBeenCalled();
  expect((screen.getByLabelText("发送给 AI 员工") as HTMLElement).textContent).toBe("");
});

it("persists only when sending and never calls the legacy create-session path",async()=>{
 setup();renderPage();await screen.findByText("会话 A");
 fireEvent.click(screen.getByRole("button",{name:"新建会话"}));
 fireEvent.click(screen.getByRole("button",{name:"新建会话"}));
 const input=screen.getByLabelText("发送给 AI 员工") as HTMLElement;
 fireEvent.paste(input,{clipboardData:{files:[],getData:()=>"首条消息标题"}});
 expect(api.createSubmission).not.toHaveBeenCalled();expect(api.createSession).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"发送消息"}));
 await waitFor(()=>expect(api.commitSubmission).toHaveBeenCalledTimes(1));
 expect(api.createSubmission).toHaveBeenCalledWith(expect.objectContaining({employeeId:"employee-a",sessionId:null,text:"首条消息标题",attachments:[]}));
 expect(api.createSession).not.toHaveBeenCalled();await waitFor(()=>expect(input.textContent).toBe(""));
});

it("switches selected conversations, keeps history on reselection and ignores closed streams", async () => {
  setup();
  const second = { ...session, id: "session-b", title: "会话 B" };
  vi.mocked(api.listSessions).mockResolvedValue({ items: [session, second] });
  vi.mocked(api.listMessages).mockImplementation(async id => ({ items: [{
    ...message, id: `message-${id}`, session_id: id,
    parts: [{ type: "text", text: id === session.id ? "A 的历史" : "B 的历史" }],
  }] }));
  renderPage();
  fireEvent.click(await screen.findByRole("option", { name: /^会话 A/ }));
  await screen.findByText("A 的历史");
  const firstSource = Events.instances[0];
  fireEvent.click(screen.getByRole("option", { name: /^会话 A/ }));
  expect(screen.getByText("A 的历史")).toBeTruthy();
  expect(firstSource.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("option", { name: /^会话 B/ }));
  await screen.findByText("B 的历史");
  expect(screen.queryByText("A 的历史")).toBeNull();
  expect(screen.getByRole("option", { name: /^会话 B/ }).getAttribute("aria-selected")).toBe("true");
  expect(firstSource.close).toHaveBeenCalled();
  act(() => {
    firstSource.emit({ event_id: "late", session_id: session.id, run_id: "old-run", seq: 1,
      type: "run.failed", payload: { errorCode: "late" }, protocol_version: 1, created_at: "" });
    firstSource.listeners.get("access_revoked")?.();
  });
  expect(screen.getByText("B 的历史")).toBeTruthy();
  expect(screen.queryByText("当前会话访问权限已失效")).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: /^会话 A/ }));
  await screen.findByText("A 的历史");
  expect(screen.queryByText("B 的历史")).toBeNull();
});

it("ignores delayed history from a session after navigating elsewhere", async () => {
  setup();
  const second = { ...session, id: "session-b", title: "会话 B" };
  vi.mocked(api.listSessions).mockResolvedValue({ items: [session, second] });
  let resolveFirst!: (value: { items: Message[] }) => void;
  vi.mocked(api.listMessages).mockImplementation(id => id === session.id
    ? new Promise(resolve => { resolveFirst = resolve; })
    : Promise.resolve({ items: [{ ...message, id: "message-b", session_id: second.id,
      parts: [{ type: "text", text: "B 的历史" }] }] }));
  renderPage();
  fireEvent.click(await screen.findByRole("option", { name: /^会话 A/ }));
  await waitFor(() => expect(resolveFirst).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("option", { name: /^会话 B/ }));
  await screen.findByText("B 的历史");
  await act(async () => { resolveFirst({ items: [message] }); });
  expect(screen.queryByText("历史消息")).toBeNull();
  expect(screen.getByText("B 的历史")).toBeTruthy();
  expect(Events.instances).toHaveLength(1);
  expect(Events.instances[0].url).toContain(second.id);
});

it("keeps IME confirmation and Shift+Enter from submitting the local V2 composer", async () => {
  setup(); renderPage();
  fireEvent.click(await screen.findByText("会话 A"));
  await screen.findByText("历史消息");
  const input = screen.getByLabelText("发送给 AI 员工");
  fireEvent.paste(input, { clipboardData: { files: [], getData: () => "/compact" } });
  expect(screen.queryByRole("listbox", { name: "DSH 命令建议" })).toBeNull();
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(api.submitCommand).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(api.createSubmission).toHaveBeenCalledWith(expect.objectContaining({text:"/compact"})));
});

it("stages file selection, drop and paste until sending and uploads through binary staging",async()=>{
 setup();renderPage();await screen.findByText("会话 A");
 const input=screen.getByLabelText("发送给 AI 员工");
 fireEvent.change(screen.getByLabelText("选择图片或文件"),{target:{files:[new File(["sheet"],"bom.xlsx")]}});
 fireEvent.drop(input.closest("form")!,{dataTransfer:{files:[new File(["document"],"note.docx")]}});
 fireEvent.paste(input,{clipboardData:{files:[new File(["image"],"image.png",{type:"image/png"})],getData:()=>""}});
 await waitFor(()=>expect(screen.getAllByRole("button",{name:/^移除附件/})).toHaveLength(3));
 expect(api.createSubmission).not.toHaveBeenCalled();expect(api.uploadStagedFile).not.toHaveBeenCalled();expect(api.createSession).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"发送消息"}));
 await waitFor(()=>expect(api.commitSubmission).toHaveBeenCalledTimes(1));
 expect(api.uploadStagedFile).toHaveBeenCalledTimes(3);expect(api.uploadWorkspaceFile).not.toHaveBeenCalled();
 expect(api.createSubmission).toHaveBeenCalledWith(expect.objectContaining({sessionId:null,attachments:expect.arrayContaining([expect.objectContaining({name:"bom.xlsx",sha256:expect.stringMatching(/^[a-f0-9]{64}$/)})])}));
 await waitFor(()=>expect(screen.queryByRole("button",{name:/^移除附件/})).toBeNull());
});

it("discards local attachments on removal and navigation without persisting",async()=>{
 setup();renderPage();await screen.findByText("会话 A");
 const pick=()=>fireEvent.change(screen.getByLabelText("选择图片或文件"),{target:{files:[new File(["test"],"test.txt")]}});
 pick();fireEvent.click(await screen.findByRole("button",{name:"移除附件 test.txt"}));pick();
 fireEvent.click(screen.getByText("会话 A"));await screen.findByText("历史消息");
 await waitFor(()=>expect(screen.queryByRole("button",{name:"移除附件 test.txt"})).toBeNull());
 pick();fireEvent.click(screen.getByRole("button",{name:"新建会话"}));await waitFor(()=>expect(screen.queryByRole("button",{name:"移除附件 test.txt"})).toBeNull());
 expect(api.createSubmission).not.toHaveBeenCalled();expect(api.uploadStagedFile).not.toHaveBeenCalled();
});
