import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "jsdom", globals: true, include: ["**/*.test.ts", "**/*.test.tsx"] },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "."), "@features": path.resolve(import.meta.dirname, "features"), "@components": path.resolve(import.meta.dirname, "app/components"), "@lib": path.resolve(import.meta.dirname, "app/lib"), "@global-components": path.resolve(import.meta.dirname, "components"), "@shared": path.resolve(import.meta.dirname, "components"), "@yaya/dsh-workbench-client": path.resolve(import.meta.dirname, "packages/dsh-workbench-client/src") } },
});
