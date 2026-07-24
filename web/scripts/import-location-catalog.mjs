import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const catalogDirectory = resolve(scriptDirectory, "../public/location-catalog");
const apiDirectory = resolve(scriptDirectory, "../../api");

// This is a maintenance command. It connects through the backend's configured
// database connection and deliberately does not call the authenticated HTTP API.
const processHandle = spawn(
  "cargo",
  ["run", "--manifest-path", resolve(apiDirectory, "Cargo.toml"), "--", "--import-location-catalog", catalogDirectory],
  {
    cwd: apiDirectory,
    stdio: "inherit",
    env: {
      ...process.env,
      CARGO_TARGET_DIR: resolve(apiDirectory, "target-location-import"),
    },
  },
);

processHandle.on("exit", (code) => process.exit(code ?? 1));
