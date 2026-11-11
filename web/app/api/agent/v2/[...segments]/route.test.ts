// @vitest-environment node
import { createServer } from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

let endpoint: string;
let upstreamHeaders: Record<string, string | string[] | undefined>;
let receivedBody = "";
let receivedBytes = Buffer.alloc(0);
const server = createServer(async (request, response) => {
  upstreamHeaders = request.headers;
  if (request.url?.includes("/events")) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`id: 3\ndata: ${JSON.stringify({ seq: 3, type: "run.queued" })}\n\n`);
    return;
  }
  if(request.url?.endsWith("/files/f")){
    response.writeHead(200,{"content-type":"image/png","content-disposition":"inline","cache-control":"public"});
    response.end(Buffer.from([137,80,78,71,0,255]));return;
  }
  receivedBody = "";
  const chunks:Buffer[]=[];
  for await (const chunk of request) {receivedBody += String(chunk);chunks.push(Buffer.from(chunk));}
  receivedBytes=Buffer.concat(chunks);
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(request.method === "POST" ? { commandId: "same-command", runId: "run" } : { items: [] }));
});

it("forwards binary staging without Base64 or JSON conversion",async()=>{
 const {PUT}=await import("./route");
 const data=new Uint8Array([0,255,137,80,78,71]);
 const response=await PUT(new Request("http://frontend/api/agent/v2/submissions/s/attachments/f",{method:"PUT",headers:{authorization:"Bearer owner","content-type":"application/octet-stream"},body:data}),{params:Promise.resolve({segments:["submissions","s","attachments","f"]})});
 expect(response.status).toBe(200);expect([...receivedBytes]).toEqual([...data]);expect(upstreamHeaders["content-type"]).toBe("application/octet-stream");expect(upstreamHeaders.authorization).toBe("Bearer owner");
});
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server missing");
  endpoint = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("BACKEND_API_BASE_URL", endpoint);vi.resetModules();
});
afterAll(async () => { vi.unstubAllEnvs();await new Promise<void>(resolve => server.close(() => resolve())); });

it("actual BFF forwards JSON commands and cookie identity without altering idempotency key", async () => {
  const { POST } = await import("./route");
  const body = { kind: "prompt", clientCommandId: "fixed-key", parts: [{ type: "text", text: "test" }] };
  const response = await POST(new Request("http://frontend/api/agent/v2/sessions/s/commands", { method: "POST", headers: { cookie: "yaya-auth-token=token-a", "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ segments: ["sessions", "s", "commands"] }) });
  expect(response.status).toBe(200);expect(await response.json()).toEqual({ commandId: "same-command", runId: "run" });
  expect(JSON.parse(receivedBody)).toEqual(body);expect(upstreamHeaders.authorization).toBe("Bearer token-a");
});

it("actual BFF forwards Last-Event-ID and streams replay frames unchanged", async () => {
  const { GET } = await import("./route");
  const response = await GET(new Request("http://frontend/api/agent/v2/sessions/s/events?after=1", { headers: { authorization: "Bearer token-b", "last-event-id": "2" } }), { params: Promise.resolve({ segments: ["sessions", "s", "events"] }) });
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  expect(response.headers.get("cache-control")).toContain("no-transform");
  expect(await response.text()).toContain("id: 3");expect(upstreamHeaders["last-event-id"]).toBe("2");expect(upstreamHeaders.authorization).toBe("Bearer token-b");
});

it("streams authenticated workspace binary bytes without JSON conversion or public caching",async()=>{
 const {GET}=await import("./route");
 const response=await GET(new Request("http://frontend/api/agent/v2/sessions/s/files/f",{headers:{cookie:"yaya-auth-token=owner-token"}}),{params:Promise.resolve({segments:["sessions","s","files","f"]})});
 expect(response.headers.get("content-type")).toBe("image/png");
 expect(response.headers.get("cache-control")).toBe("private, no-store");
 expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([137,80,78,71,0,255]);
 expect(upstreamHeaders.authorization).toBe("Bearer owner-token");
});
