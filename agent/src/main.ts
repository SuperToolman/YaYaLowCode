import { Context, type Fiber } from "@deepseek-ai/cordis";
import { loadConfig, loadPluginConfig, loadPluginModule, validateManifest, validatePluginConfig, type PluginManifest } from "./config.js";
import { createHttpGateway } from "./plugins/http-gateway.js";
import { LoopService } from "./plugins/loop.js";
import { createOpenAiCompatibleModel } from "./plugins/model-openai-compatible.js";
import { createPlatformClient } from "./plugins/platform-client.js";
import { platformTools } from "./plugins/platform-tools.js";
import { PolicyService } from "./plugins/policy.js";
import { SessionService } from "./plugins/sessions.js";
import { createJsonStorage } from "./plugins/storage-json.js";
import { createPostgresStorage } from "./plugins/storage-postgres.js";
import { ToolService } from "./plugins/tools.js";
import { MemoryService } from "./plugins/memory.js";
import { AuditService } from "./plugins/audit.js";
import { SandboxService } from "./plugins/sandbox.js";
import { SchedulerService } from "./plugins/scheduler.js";
import { createLangGraphWorkflowClient } from "./plugins/workflow-langgraph-client.js";
import { createPersistentScheduler } from "./plugins/scheduler-pgboss.js";
import { SkillsService } from "./plugins/skills.js";
import { DefaultUiAdapter } from "./plugins/ui-adapter.js";

const config = loadConfig();
const pluginConfig = await loadPluginConfig(config.pluginConfigPath);
export const ctx = new Context();
export const fibers: Fiber[] = [];
const loadedFibers: Array<{ name: string; fiber: Fiber }> = [];

const builtins: Array<{ name: string; manifest: PluginManifest; plugin: unknown; config?: unknown }> = [
  { name: "storage-json", manifest: { id: "storage-json", version: "1.0.0", provides: ["storage"], capabilities: ["session.persistence"] }, plugin: createJsonStorage(config.storagePath) },
  { name: "storage-postgres", manifest: { id: "storage-postgres", version: "1.0.0", provides: ["storage"], capabilities: ["session.persistence", "run.persistence", "memory.persistence"] }, plugin: createPostgresStorage(config.postgresUrl) },
  { name: "sessions", manifest: { id: "sessions", version: "1.0.0", provides: ["sessions"], requires: ["storage"] }, plugin: SessionService },
  { name: "policy", manifest: { id: "policy", version: "1.0.0", provides: ["policy"], requires: ["platform"] }, plugin: PolicyService },
  { name: "platform-client", manifest: { id: "platform-client", version: "1.0.0", provides: ["platform", "identity", "pending-actions"], capabilities: ["platform.boundary"] }, plugin: createPlatformClient(config.platformApiBaseUrl) },
  { name: "tools", manifest: { id: "tools", version: "1.0.0", provides: ["tools"], requires: ["policy"] }, plugin: ToolService },
  { name: "memory", manifest: { id: "memory", version: "1.0.0", provides: ["memory"], requires: ["storage"], capabilities: ["memory.scoped", "memory.retention", "memory.erasure"] }, plugin: MemoryService },
  { name: "audit", manifest: { id: "audit", version: "1.0.0", provides: ["audit"], requires: ["storage"], capabilities: ["audit.run-steps"] }, plugin: AuditService },
  { name: "sandbox", manifest: { id: "sandbox", version: "1.0.0", provides: ["sandbox"], capabilities: ["sandbox.policy"] }, plugin: SandboxService },
  { name: "scheduler", manifest: { id: "scheduler", version: "1.0.0", provides: ["scheduler"], capabilities: ["scheduler.in-process"] }, plugin: SchedulerService },
  { name: "scheduler-pgboss", manifest: { id: "scheduler-pgboss", version: "1.0.0", provides: ["scheduler"], capabilities: ["scheduler.persistent"] }, plugin: createPersistentScheduler(config.postgresUrl) },
  { name: "skills", manifest: { id: "skills", version: "1.0.0", provides: ["skills"], configSchema: { type: "object", properties: { skills: { type: "object" } } }, capabilities: ["skills.instructions", "skills.configured"] }, plugin: SkillsService },
  { name: "ui-adapter", manifest: { id: "ui-adapter", version: "1.0.0", provides: ["ui"], capabilities: ["ui.protocol"] }, plugin: DefaultUiAdapter },
  { name: "platform-tools", manifest: { id: "platform-tools", version: "1.0.0", provides: ["platform-tools"], requires: ["platform", "tools"] }, plugin: platformTools },
  { name: "model-openai-compatible", manifest: { id: "model-openai-compatible", version: "1.0.0", provides: ["model"], capabilities: ["llm.openai-compatible"] }, plugin: createOpenAiCompatibleModel() },
  { name: "workflow-engine", manifest: { id: "workflow-engine", version: "1.0.0", provides: ["workflow"], requires: ["model", "sessions", "tools", "memory", "audit", "skills"], capabilities: ["workflow.streaming", "workflow.interruptible", "workflow.durable"] }, plugin: LoopService },
  { name: "workflow-langgraph-client", manifest: { id: "workflow-langgraph-client", version: "1.0.0", provides: ["workflow"], requires: ["sessions", "tools", "storage", "memory", "audit", "skills"], capabilities: ["workflow.langgraph", "workflow.checkpoint"] }, plugin: createLangGraphWorkflowClient(config.langGraphWorkerUrl, config.workerInternalToken) },
  { name: "http-gateway", manifest: { id: "http-gateway", version: "1.0.0", provides: ["gateway"], requires: ["workflow", "sessions", "tools", "platform", "storage", "ui"] }, plugin: createHttpGateway(config.host, config.port) },
];

const selected: Array<{ name: string; manifest: PluginManifest; plugin: any; config?: unknown }> = [];
for (const builtin of builtins) {
  const setting = pluginConfig.plugins[builtin.name];
  if (setting?.enabled === false) continue;
  const loaded = setting?.module ? await loadPluginModule(config.pluginConfigPath, setting.module) : { plugin: builtin.plugin, manifest: undefined };
  const manifest = validateManifest(builtin.name, builtin.manifest, { ...loaded.manifest, ...setting?.manifest });
  const itemConfig = setting?.config ?? builtin.config;
  validatePluginConfig(builtin.name, itemConfig, manifest.configSchema, setting?.capabilities, manifest.capabilities);
  selected.push({ name: builtin.name, manifest, plugin: loaded.plugin, config: itemConfig });
}
for (const extension of pluginConfig.extensions ?? []) {
  if (extension.enabled === false) continue;
  const loaded = await loadPluginModule(config.pluginConfigPath, extension.module);
  const manifest = loaded.manifest ?? extension.manifest;
  if (!manifest?.id || !manifest.version || !manifest.provides) throw new Error(`Extension ${extension.name} must provide a complete manifest`);
  validatePluginConfig(extension.name, extension.config, manifest.configSchema, undefined, manifest.capabilities);
  selected.push({ name: extension.name, manifest: manifest as PluginManifest, plugin: loaded.plugin, config: extension.config });
}

const providers = new Set<string>();
const pending = [...selected];
const ordered: typeof selected = [];
while (pending.length) {
  const index = pending.findIndex((item) => (item.manifest.requires ?? []).every((dependency) => providers.has(dependency)));
  if (index < 0) throw new Error(`Unable to resolve plugin dependencies: ${pending.map((item) => `${item.name} -> ${(item.manifest.requires ?? []).join(", ")}`).join("; ")}`);
  const [item] = pending.splice(index, 1);
  for (const provider of item.manifest.provides) {
    if (providers.has(provider)) throw new Error(`Multiple enabled plugins provide ${provider}; select exactly one implementation`);
  }
  ordered.push(item);
  item.manifest.provides.forEach((provider) => providers.add(provider));
}

for (const item of ordered) {
  const fiber = ctx.plugin(item.plugin, item.config);
  fibers.push(fiber);
  loadedFibers.push({ name: item.name, fiber });
  await fiber.await();
}

const inactive = loadedFibers.filter(({ fiber }) => fiber.state !== 2);
if (inactive.length) {
  throw new Error(`Agent plugins did not become active: ${inactive.map(({ name }) => name).join(", ")}`);
}

console.log(`YaYa Agent is listening on http://${config.host}:${config.port}`);

async function shutdown() {
  await Promise.all(fibers.map((fiber) => fiber.dispose()));
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
