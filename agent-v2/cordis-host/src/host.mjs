import { Context } from "cordis";
import { once } from "node:events";
import { createToolRegistry } from "./registry.mjs";
import * as diagnostic from "./plugins/diagnostic.mjs";

const MAX_FRAME = 1024 * 1024;
const MAX_CONCURRENT = 16;
const ctx = new Context();
const registry = createToolRegistry();
const provider = await ctx.plugin({ name: "yaya-tool-registry", apply: (context) => { context.provide("tools", registry); } });
let plugin = await ctx.plugin(diagnostic);
let initialized = false;
let draining = false;
const pending = new Map();
let writes = Promise.resolve();

async function write(frame) {
  let text = JSON.stringify(frame) + "\n";
  if (Buffer.byteLength(text) > MAX_FRAME) text = JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: -32001, message: "result exceeds frame limit" } }) + "\n";
  writes = writes.then(async () => { if (!process.stdout.write(text)) await once(process.stdout, "drain"); });
  await writes;
}

async function dispatch(method, params = {}) {
  if (method === "host.initialize") {
    if (params.protocolVersion !== 1) throw new Error("unsupported protocol version");
    initialized = true;
    return { protocolVersion: 1, cordisVersion: "4.0.0-rc.12", maxFrameBytes: MAX_FRAME };
  }
  if (!initialized) throw new Error("initialize required");
  if (method === "health.check") return { ready: !draining, active: pending.size };
  if (method === "capability.list") return { tools: registry.list() };
  if (method === "invocation.cancel") { pending.get(params.invocationId)?.abort(); return { accepted: true }; }
  if (method === "plugin.dispose") {
    draining = true;
    for (const controller of pending.values()) controller.abort();
    await plugin.dispose();
    await provider.dispose();
    return { disposed: true, remainingTools: registry.list().length };
  }
  if (method === "plugin.activate") {
    if (!draining) throw new Error("already active");
    throw new Error("restart Host to activate the fixed plugin set");
  }
  if (method !== "tool.invoke" || draining) throw new Error("method unavailable");
  if (pending.size >= MAX_CONCURRENT) throw new Error("Host concurrency exceeded");
  if (typeof params.invocationId !== "string" || pending.has(params.invocationId) || !params.scope || typeof params.scope !== "object") throw new Error("invalid invocation scope/id");
  const controller = new AbortController();
  pending.set(params.invocationId, controller);
  try { return await registry.invoke(params.name, params.arguments, { signal: controller.signal, scope: Object.freeze({ ...params.scope }) }); }
  finally { pending.delete(params.invocationId); }
}

const inflight = new Set();
async function handle(line) {
  let request;
  try {
    request = JSON.parse(line);
    if (request.jsonrpc !== "2.0" || !(typeof request.id === "number" || typeof request.id === "string") || typeof request.method !== "string") throw new Error("invalid request");
    const result = await dispatch(request.method, request.params);
    await write({ jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    await write({ jsonrpc: "2.0", id: request?.id ?? null, error: { code: -32000, message: error.message } });
  }
}

let buffer = Buffer.alloc(0);
for await (const chunk of process.stdin) {
  buffer = Buffer.concat([buffer, chunk]);
  let index;
  while ((index = buffer.indexOf(10)) >= 0) {
    const line = buffer.subarray(0, index);
    buffer = buffer.subarray(index + 1);
    if (line.length > MAX_FRAME || inflight.size >= MAX_CONCURRENT + 4) { process.exitCode = 1; process.stdin.destroy(); break; }
    const promise = handle(line.toString("utf8"));
    inflight.add(promise);
    promise.finally(() => inflight.delete(promise));
  }
  if (buffer.length > MAX_FRAME) { process.exitCode = 1; break; }
}
for (const controller of pending.values()) controller.abort();
await Promise.allSettled([...inflight]);
if (!draining) { await plugin.dispose(); await provider.dispose(); }
await writes;
