import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const catalogDirectory = resolve(
  process.env.LOCATION_CATALOG_OUTPUT_DIR ?? resolve(scriptDirectory, "../data/location-catalog"),
);
const apiDirectory = resolve(scriptDirectory, "../../api");

// This is a maintenance command. It connects through the backend's configured
// database connection and deliberately does not call the authenticated HTTP API.
const processHandle = spawn(
  "cargo",
  ["run", "--manifest-path", resolve(apiDirectory, "Cargo.toml"), "--", "--import-location-catalog", catalogDirectory],
  {
    cwd: apiDirectory,
    stdio: "inherit",
  },
);

processHandle.on("exit", (code) => process.exit(code ?? 1));
