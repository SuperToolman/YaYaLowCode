import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./openapi/openapi.json",
  output: "./app/lib/api-client",
  plugins: [
    "@hey-api/client-fetch",
    "@hey-api/sdk",
  ],
});
