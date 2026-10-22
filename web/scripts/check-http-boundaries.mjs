import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const generatedConsumers = new Set(["app/lib/http.ts", "app/lib/api-client-runtime.ts", "app/lib/backend-client.ts"]);
// Next owns these contracts; they are deliberately absent from Rust OpenAPI.
const bffRequests = new Map([
  ["features/auth/api.ts", /^\/api\/auth\/(login|logout|session|sms\/login|sms\/send-code)$/],
  ["features/agent-workbench/platform-api.ts", /^\/api\/agent\/available-agents/],
]);
const failures = [];
function walk(directory) {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!new Set(["api-client", "node_modules", ".next", "dsh"]).has(entry.name)) walk(file);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
    const source = readFileSync(path.join(root, file), "utf8");
    if (/(?:from\s*|import\s*\()["'][^"']*api-client(?:\/|["'])/.test(source) && !generatedConsumers.has(file)) failures.push(`${file}: import SDK through app/lib/http`);
    if (!file.startsWith("features/")) continue;
    if (/\bas\s+never\b|\bas\s+unknown\s+as\b/.test(source) && /(?:api|platform-api)\.ts$/.test(file)) failures.push(`${file}: unsafe contract cast`);
    if (/function\s+unwrap\b/.test(source)) failures.push(`${file}: use unwrapApiResult`);
    for (const match of source.matchAll(/\brequestApi(?:<[^;]*?>)?\(\s*["'`]([^"'`]+)/g)) {
      if (!bffRequests.get(file)?.test(match[1])) failures.push(`${file}: handwritten HTTP contract ${match[1]}`);
    }
    if (/\b(?:fetch|controlledFetch)\s*\(/.test(source) && file !== "features/shared/request.ts") failures.push(`${file}: use the stable SDK or an explicitly scoped special transport`);
  }
}
for (const directory of ["app", "features", "components"]) walk(directory);
const generatedIndex = readFileSync(path.join(root, "app/lib/api-client/index.ts"), "utf8");
if (/controlledFetch|Compatibility aliases/.test(generatedIndex)) failures.push("generated index contains runtime patches");
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.log("HTTP boundaries checked.");
