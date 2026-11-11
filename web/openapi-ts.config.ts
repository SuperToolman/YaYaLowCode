import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../api/openapi/openapi.json",
  output: "./shared/lib/api-client",
  plugins: [
    { name: "@hey-api/client-fetch", runtimeConfigPath: "./shared/lib/api-client-runtime" },
    "@hey-api/sdk",
  ],
});
