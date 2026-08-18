import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type Context } from "@deepseek-ai/cordis";
import type { AgentRequestContext, AgentStreamEvent } from "../contracts.js";

export function createHttpGateway(host: string, port: number) {
  return Object.assign((ctx: Context) => {
    const server = createServer((request, response) => void handle(ctx, request, response));
    server.listen(port, host);
    return () => server.close();
}, { inject: ["workflow", "sessions", "tools", "platform", "storage", "ui"] });
}

async function handle(ctx: Context, request: IncomingMessage, response: ServerResponse) {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const legacy = url.pathname.startsWith("/api/agent/");
    const path = legacy ? legacyPath(url.pathname) : url.pathname;
    if (request.method === "GET" && url.pathname === "/healthz") return json(response, 200, { status: "ok" });
    if (request.method === "GET" && url.pathname === "/v1/plugins") return json(response, 200, { tools: ctx.tools.list().map(({ name, description, requiresApproval }) => ({ name, description, requiresApproval })) });
    const context = await requestContext(ctx, request, url);
    if (request.method === "GET" && path === "/v1/available-agents") return json(response, 200, envelope([ctx.ui.availableAgent()], legacy));
    if (request.method === "GET" && path === "/v1/sessions") return json(response, 200, envelope((await ctx.sessions.list(context)).map((session) => ctx.ui.publicSession(session)), legacy));
    if (request.method === "POST" && path === "/v1/sessions") {
      const body = await bodyJson(request) as { title?: string };
      return json(response, 201, envelope(ctx.ui.publicSession(await ctx.sessions.create(context, body.title)), legacy));
    }
    const sessionMatch = path.match(/^\/v1\/sessions\/([^/]+)$/);
    if (request.method === "PATCH" && sessionMatch) {
      const body = await bodyJson(request) as { title?: string };
      if (!body.title?.trim()) throw new HttpError(400, "title is required");
      return json(response, 200, envelope(ctx.ui.publicSession(await ctx.sessions.update(context, decodeURIComponent(sessionMatch[1]), { title: body.title.trim() })), legacy));
    }
    if (request.method === "DELETE" && sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      await ctx.sessions.delete(context, sessionId);
      return json(response, 200, envelope({ id: sessionId }, legacy));
    }
    const messageMatch = path.match(/^\/v1\/sessions\/([^/]+)\/messages$/);
    if (request.method === "GET" && messageMatch) return json(response, 200, envelope(await ctx.sessions.messages(context, decodeURIComponent(messageMatch[1])), legacy));
    if (request.method === "POST" && messageMatch) {
      context.sessionId = decodeURIComponent(messageMatch[1]);
      const body = await bodyJson(request) as { content?: string };
      if (!body.content?.trim()) throw new HttpError(400, "content is required");
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
      const clientAbort = new AbortController();
      request.once("aborted", () => clientAbort.abort(new Error("Client request aborted")));
      response.once("close", () => { if (!response.writableEnded) clientAbort.abort(new Error("Client disconnected")); });
      context.abortSignal = clientAbort.signal;
      for await (const event of ctx.workflow.run(decodeURIComponent(messageMatch[1]), body.content, context)) {
        ctx.emit("agent/event", event, context);
        writeEvent(response, event);
      }
      response.end();
      return;
    }
    const actionsMatch = path.match(/^\/v1\/sessions\/([^/]+)\/pending-actions$/);
    if (request.method === "GET" && actionsMatch) {
      const sessionId = decodeURIComponent(actionsMatch[1]);
      context.sessionId = sessionId;
      await ctx.sessions.messages(context, sessionId);
      return json(response, 200, envelope(await ctx.platform.listPendingActions(context, sessionId), legacy));
    }
    if (request.method === "POST" && actionsMatch) {
      const sessionId = decodeURIComponent(actionsMatch[1]);
      context.sessionId = sessionId;
      await ctx.sessions.messages(context, sessionId);
      const body = await bodyJson(request) as { actionType?: string; payload?: unknown; summary?: string; expiresAt?: string };
      if (!body.actionType || !body.summary) throw new HttpError(400, "actionType and summary are required");
      return json(response, 201, envelope(await ctx.platform.createPendingAction(context, {
        sessionId,
        actionType: body.actionType,
        payload: body.payload ?? {},
        summary: body.summary,
        expiresAt: body.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }), legacy));
    }
    const actionMatch = path.match(/^\/v1\/sessions\/([^/]+)\/pending-actions\/([^/]+)\/(confirm|cancel)$/);
    if (request.method === "POST" && actionMatch) {
      const sessionId = decodeURIComponent(actionMatch[1]);
      const actionId = decodeURIComponent(actionMatch[2]);
      context.sessionId = sessionId;
      await ctx.sessions.messages(context, sessionId);
      if (actionMatch[3] === "confirm") {
        const action = (await ctx.platform.listPendingActions(context, sessionId)).find((item) => item.id === actionId);
        if (!action) throw new HttpError(404, "pending action not found");
        const result = await ctx.platform.confirmPendingAction(context, sessionId, actionId);
        const message = await ctx.workflow.resume(sessionId, action, result, context);
        return json(response, 200, envelope({ result, message: { id: message.id } }, legacy));
      }
      await ctx.platform.cancelPendingAction(context, sessionId, actionId);
      await ctx.storage.deleteCheckpoint(sessionId, actionId);
      return json(response, 200, envelope({ id: actionId, status: "cancelled" }, legacy));
    }
    throw new HttpError(404, "Not found");
  } catch (error) {
    if (!response.headersSent) json(response, error instanceof HttpError ? error.status : 500, { error: error instanceof Error ? error.message : "Internal error" });
    else response.end();
  }
}

async function requestContext(ctx: Context, request: IncomingMessage, url: URL): Promise<AgentRequestContext> {
  const authorization = request.headers.authorization ?? "";
  if (!authorization.startsWith("Bearer ")) throw new HttpError(401, "Platform authorization is required");
  const identity = await ctx.platform.identity(authorization);
    return {
    authorization,
    requestId: request.headers["x-request-id"]?.toString() ?? randomUUID(),
    identity,
    appId: url.searchParams.get("appId") ?? undefined,
    formUuid: url.searchParams.get("formUuid") ?? undefined,
    route: url.searchParams.get("route") ?? undefined,
  };
}

async function bodyJson(request: IncomingMessage) {
  let body = "";
  for await (const chunk of request) body += chunk;
  try { return JSON.parse(body || "{}"); } catch { throw new HttpError(400, "Invalid JSON request body"); }
}

function json(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function writeEvent(response: ServerResponse, event: AgentStreamEvent) {
  response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function envelope<T>(data: T, legacy: boolean) {
  return legacy ? { code: 0, data, message: "ok", time: new Date().toISOString() } : data;
}

function legacyPath(pathname: string) {
  if (pathname === "/api/agent/available-agents") return "/v1/available-agents";
  if (pathname === "/api/agent/sessions") return "/v1/sessions";
  return pathname.replace(/^\/api\/agent/, "/v1");
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
