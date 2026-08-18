import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin } from "@deepseek-ai/cordis";

export type PluginManifest = {
  id: string;
  version: string;
  provides: string[];
  requires?: string[];
  configSchema?: unknown;
  capabilities?: string[];
};

export type AgentConfig = {
  host: string;
  port: number;
  platformApiBaseUrl: string;
  storagePath: string;
  postgresUrl: string;
  langGraphWorkerUrl: string;
  workerInternalToken: string;
  pluginConfigPath: string;
};

export type PluginConfig = {
  plugins: Record<string, {
    enabled?: boolean;
    module?: string;
    config?: unknown;
    manifest?: Partial<PluginManifest>;
    capabilities?: string[];
  }>;
  extensions?: Array<{ name: string; module: string; enabled?: boolean; config?: unknown; manifest?: Partial<PluginManifest> }>;
};

export function loadConfig(): AgentConfig {
  return {
    host: process.env.AGENT_HOST ?? "127.0.0.1",
    port: Number(process.env.AGENT_PORT ?? "8789"),
    platformApiBaseUrl: (process.env.PLATFORM_API_BASE_URL ?? "http://127.0.0.1:8788").replace(/\/$/, ""),
    storagePath: resolve(process.env.AGENT_STORAGE_PATH ?? "./runtime/agent-store.json"),
    postgresUrl: process.env.AGENT_POSTGRES_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/yaya",
    langGraphWorkerUrl: process.env.LANGGRAPH_WORKER_URL ?? "http://127.0.0.1:8790",
    workerInternalToken: process.env.AGENT_WORKER_INTERNAL_TOKEN ?? "",
    pluginConfigPath: resolve(process.env.AGENT_PLUGIN_CONFIG_PATH ?? "./config/plugins.json"),
  };
}

export async function loadPluginConfig(path: string): Promise<PluginConfig> {
  return JSON.parse(await readFile(path, "utf8")) as PluginConfig;
}

export async function loadPluginModule(configPath: string, module: string): Promise<{ plugin: Plugin; manifest?: PluginManifest }> {
  const specifier = module.startsWith(".")
    ? pathToFileURL(resolve(dirname(configPath), module)).href
    : module;
  const loaded = await import(specifier) as { default?: Plugin; plugin?: Plugin; manifest?: PluginManifest };
  const plugin = loaded.default ?? loaded.plugin;
  if (!plugin) throw new Error(`Plugin module ${module} must export a default Cordis plugin`);
  return { plugin, manifest: loaded.manifest };
}

export function validateManifest(name: string, expected: PluginManifest, actual?: Partial<PluginManifest>) {
  const manifest = { ...expected, ...actual };
  if (manifest.id !== expected.id) throw new Error(`Plugin ${name} manifest id must be ${expected.id}`);
  if (!manifest.version) throw new Error(`Plugin ${name} manifest version is required`);
  for (const capability of expected.provides) {
    if (!manifest.provides?.includes(capability)) throw new Error(`Plugin ${name} does not provide ${capability}`);
  }
  return manifest;
}

export function validatePluginConfig(name: string, config: unknown, schema: unknown, requestedCapabilities?: string[], manifestCapabilities: string[] = []) {
  if (requestedCapabilities?.some((capability) => !manifestCapabilities.includes(capability))) {
    throw new Error(`Plugin ${name} does not provide every requested capability`);
  }
  if (!schema || typeof schema !== "object") return;
  const definition = schema as { type?: string; required?: string[]; properties?: Record<string, { type?: string }> };
  if (definition.type === "object" && (config === null || typeof config !== "object" || Array.isArray(config))) {
    throw new Error(`Plugin ${name} configuration must be an object`);
  }
  const value = (config ?? {}) as Record<string, unknown>;
  for (const key of definition.required ?? []) if (value[key] === undefined) throw new Error(`Plugin ${name} configuration is missing ${key}`);
  for (const [key, property] of Object.entries(definition.properties ?? {})) {
    if (value[key] !== undefined && property.type && typeof value[key] !== property.type) throw new Error(`Plugin ${name} configuration ${key} must be ${property.type}`);
  }
}
