import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("keeps product frontend sources independent of legacy feature modules, DSH, and legacy endpoints", () => {
  function inspect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) { inspect(filename); continue; }
      if (!/\.tsx?$/.test(filename) || /\.test\.tsx?$/.test(filename)) continue;
      const source = readFileSync(filename, "utf8");
      expect(source, filename).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*(?:agent-assistant|agent-workbench|agent-resources|@yaya\/dsh|deepseek-harness)/);
      expect(source, filename).not.toMatch(/\/api\/agent\/(?:sessions|available-agents|runtime(?:-identity|-employees|-model-route)?|development|plugins|workbench|archived-sessions|dsh|profiles|agents|skills)(?:[/?"'`]|$)/);
    }
  }
  for (const directory of ["features", "app", "shared"]) inspect(path.resolve(directory));
});

it("removes retired DSH source and Next routes from the product checkout", () => {
  for (const entry of [
    "../agent/deepseek-harness", "features/agent-assistant", "features/agent-workbench",
    "features/agent-resources", "packages/dsh-workbench-client",
    "app/api/agent/dsh", "app/api/agent/workbench", "app/api/agent/sessions",
    "app/api/agent/archived-sessions", "app/api/agent/available-agents",
    "app/api/agent/development/route.ts", "app/api/_lib/agent-runtime-proxy.ts",
    "app/lib/agent-development-api.ts", "app/lib/agent-development-contracts.ts",
    "app/components/agent/AgentAssistantTrigger.tsx",
    "app/(protected)/settings/agent-archive",
    "../api/src/modules/agents", "../api/src/modules/agent_files.rs",
    "../scripts/start-dev-skipDshBuild.ps1",
  ]) {
    expect(existsSync(path.resolve(entry)), entry).toBe(false);
  }
});

it("keeps shipping and startup configuration free of retired runtime wiring", () => {
  for (const entry of [
    "../deploy/compose.yaml", "../deploy/Dockerfile.single", "../deploy/Dockerfile.api",
    "../deploy/supervisord.single.conf", "../deploy/entrypoint-single.sh",
    "../scripts/start-dev.ps1", "../deploy/publish.ps1", "../deploy/publish-web.ps1",
  ]) {
    const source = readFileSync(path.resolve(entry), "utf8");
    expect(source, entry).not.toMatch(/DSH_[A-Z_]+|AGENT_RUNTIME_SHARED_SECRET|YAYA_AGENT_SETTINGS_PATH|deepseek-harness|langgraph-worker|SkipDshBuild|SkipLegacyAgent|\b8789\b|\b8790\b/);
  }
  const publisher = readFileSync(path.resolve("../deploy/publish.ps1"), "utf8");
  expect(publisher).toContain("Where-Object { $_.Name -ne 'agent' }");
});
