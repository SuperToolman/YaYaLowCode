import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../api/openapi/openapi.json",
  output: "./app/lib/api-client",
  plugins: [
    { name: "@hey-api/client-fetch", runtimeConfigPath: "./app/lib/api-client-runtime" },
    "@hey-api/sdk",
  ],
});
