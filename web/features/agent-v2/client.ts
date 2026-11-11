import { readAuthStorage, AUTH_TOKEN_STORAGE_KEY } from "@/shared/lib/auth";
import { agentV2CreateSubmission, agentV2Submission, agentV2UploadStagedFile, agentV2CommitSubmission, agentV2AbandonSubmission, agentV2FilePreviews } from "@/shared/lib/http";
import type { SubmissionInput, Submission, FilePreview } from "@/shared/lib/http";
export type { SubmissionInput, Submission, FilePreview };
import { agentV2ForkSession, agentV2ArchiveAction, agentV2Session, agentV2UpdateSession, agentV2ExecutionLogs, agentV2Employees, agentV2Sessions, agentV2CreateSession, agentV2Messages, agentV2Command, agentV2Confirmations, agentV2Files, agentV2UploadFile, agentV2Executions } from "@/shared/lib/http";
import type { ExecutionRecord } from "@/shared/lib/http";
export type { ExecutionRecord };
export const listExecutions = (sessionId: string, signal?: AbortSignal) => agentV2Executions({ ...options(signal), path: { session_id: sessionId } }).then(result => result.data);
import type { AgentV2Employee, AgentV2Session, AgentV2Message, AgentV2Event, AgentV2Confirmation, AgentV2File, Command } from "@/shared/lib/http";

export type Employee = AgentV2Employee;
export type Session = AgentV2Session;
export type Message = AgentV2Message;
export type Confirmation = AgentV2Confirmation;
export type AgentEvent = Omit<AgentV2Event, "payload"> & { payload: Record<string, unknown> };

function options(signal?: AbortSignal) {
  const token = readAuthStorage(AUTH_TOKEN_STORAGE_KEY);
  return { headers: token ? { authorization: `Bearer ${token}` } : {}, signal, responseStyle: "fields" as const, throwOnError: true as const };
}
export const listEmployees = (signal?: AbortSignal) => agentV2Employees(options(signal)).then(result => result.data);
export const listSessions = (signal?: AbortSignal, query?: { employee_id?: string; search?: string; search_in?: "all" | "title" | "content"; archived?: boolean; cursor?: string; include_token_usage?: boolean }) => agentV2Sessions({ ...options(signal), query }).then(result => result.data);
export const readSession = (sessionId: string, signal?: AbortSignal) => agentV2Session({ ...options(signal), path: { session_id: sessionId } }).then(result => result.data);
export type SessionUpdate = NonNullable<Parameters<typeof agentV2UpdateSession>[0]>["body"];
export const updateSession = (sessionId: string, body: SessionUpdate) => agentV2UpdateSession({ ...options(), path: { session_id: sessionId }, body }).then(result => result.data);
export const createSession = (employeeId: string) => agentV2CreateSession({ ...options(), body: { employeeId } }).then(result => result.data);
export const listMessages = (sessionId: string, signal?: AbortSignal, before?: string) => agentV2Messages({ ...options(signal), path: { session_id: sessionId }, query: before ? { before: Number(before) } : undefined }).then(result => result.data);
export const submitCommand = (sessionId: string, body: Command) => agentV2Command({ ...options(), path: { session_id: sessionId }, body }).then(result => result.data);

/** Stream attempts replace their own partial output; only run.completed is final. */
export function streamText(events: AgentEvent[], runId: string): string {
  let text = "";
  let segment = "";
  let latest = -1;
  for (const event of events) {
    if (event.run_id !== runId || event.seq <= latest) continue;
    latest = event.seq;
    if (event.type === "message.delta") {
      const key = `${event.payload.step}:${event.payload.attempt}`;
      if (key !== segment) { text = ""; segment = key; }
      if (typeof event.payload.text === "string") text += event.payload.text;
    }
    if (event.type === "run.completed") text = String(event.payload.text ?? "");
  }
  return text;
}

export const listConfirmations = (sessionId: string, signal?: AbortSignal) => agentV2Confirmations({ ...options(signal), path: { session_id: sessionId } }).then(result => result.data);

export type WorkspaceFile = AgentV2File;
export const listWorkspaceFiles = (sessionId: string, signal?: AbortSignal) => agentV2Files({...options(signal),path:{session_id:sessionId}}).then(result=>result.data);
export async function uploadWorkspaceFile(sessionId:string,file:File,clientFileId:string) {
  const data=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(",",2)[1]);
    reader.onerror=()=>reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
  return agentV2UploadFile({...options(),path:{session_id:sessionId},body:{clientFileId,name:file.name,data}}).then(result=>result.data);
}

export const createSubmission = (body: SubmissionInput) => agentV2CreateSubmission({ ...options(), body }).then(r => r.data);
export const getSubmission = (id: string) => agentV2Submission({ ...options(), path: { submission_id: id } }).then(r => r.data);
export const commitSubmission = (id: string) => agentV2CommitSubmission({ ...options(), path: { submission_id: id } }).then(r => r.data);
export const abandonSubmission = (id: string) => agentV2AbandonSubmission({ ...options(), path: { submission_id: id } }).then(r => r.data);
export const uploadStagedFile = (id: string, fileId: string, file: File, signal?: AbortSignal) => agentV2UploadStagedFile({
 ...options(signal), path: { submission_id: id, file_id: fileId },
 // The generated binary schema describes the wire bytes; fetch accepts the Blob directly.
 body: file as unknown as Parameters<typeof agentV2UploadStagedFile>[0]["body"],
}).then(r => r.data);
export const listFilePreviews = (id: string, signal?: AbortSignal) => agentV2FilePreviews({ ...options(signal), path: { session_id: id } }).then(r => r.data);

export const readExecutionLogs=(sessionId:string,executionId:string,stream:"stdout"|"stderr",offset:number,signal?:AbortSignal)=>agentV2ExecutionLogs({...options(signal),path:{session_id:sessionId,execution_id:executionId},query:{stream,offset}}).then(r=>r.data);

export const archiveAction = (sessionIds: string[], action: "restore" | "delete") => agentV2ArchiveAction({...options(),body:{sessionIds,action}}).then(result=>result.data);

export const forkSession = (sessionId: string, messageId: string, clientRequestId: string) => agentV2ForkSession({...options(),path:{session_id:sessionId},body:{messageId,clientRequestId}}).then(result=>result.data);
