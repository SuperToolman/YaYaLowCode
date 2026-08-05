import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**/*.{ts,tsx}", "features/**/*.{ts,tsx}"],
    ignores: [
      "app/api/**",
      "app/lib/api-client/**",
      "features/**/api.ts",
      "features/**/queries.ts",
      "features/**/mutations.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          "@/app/lib/api-client",
          "**/app/lib/api-client",
        ],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "src-tauri/gen/**",
    "src-tauri/target/**",
    "next-env.d.ts",
    "app/lib/api-client/**",
  ]),
]);

export default eslintConfig;
