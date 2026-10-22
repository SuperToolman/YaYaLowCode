import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(path.dirname(require.resolve("monaco-editor/package.json")), "min", "vs");
const destination = path.join(root, "public", "monaco", "vs");
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
