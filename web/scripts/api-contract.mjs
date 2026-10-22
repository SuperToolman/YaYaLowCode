import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const web = fileURLToPath(new URL("../", import.meta.url));
function run(command, args, cwd = web) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function snapshot(directory = path.join(web, "app/lib/api-client")) {
  const hash = createHash("sha256");
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else { hash.update(path.relative(directory, file)); hash.update(readFileSync(file)); }
    }
  }
  visit(directory);
  return hash.digest("hex");
}
const mode = process.argv[2];
if (mode === "export" || mode === "update") {
  // The test binary avoids overwriting a development API executable in use on Windows.
  run("cargo", ["test", "openapi::tests::export_current_openapi", "--", "--ignored"], path.join(web, "../api"));
}
if (mode === "update") { run("pnpm", ["run", "codegen:api"]); run("pnpm", ["exec", "tsc", "--noEmit"]); }
if (mode === "check") {
  const before = snapshot();
  run("pnpm", ["run", "codegen:api"]);
  if (snapshot() !== before) { console.error("SDK differs from the saved OpenAPI contract; regenerate and review the changes."); process.exit(1); }
  run("pnpm", ["exec", "tsc", "--noEmit"]);
}
