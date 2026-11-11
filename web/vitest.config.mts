import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom", globals: true,
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: [...configDefaults.exclude, ".cache/**", ".next/**", "tauri-dist/**", "src-tauri/**"],
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
});
