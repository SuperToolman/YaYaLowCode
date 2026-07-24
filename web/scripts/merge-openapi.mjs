import { readFile, writeFile } from "node:fs/promises";

const [basePath, generatedPath, outputPath] = process.argv.slice(2);

if (!basePath || !generatedPath || !outputPath) {
  throw new Error("Usage: node merge-openapi.mjs <base> <generated> <output>");
}

const [base, generated] = await Promise.all(
  [basePath, generatedPath].map(async (path) =>
    JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")),
  ),
);

const paths = { ...generated.paths };
for (const [path, baseOperations] of Object.entries(base.paths ?? {})) {
  paths[path] = {
    ...paths[path],
    ...baseOperations,
  };
}

const merged = {
  ...generated,
  ...base,
  paths,
  components: {
    ...generated.components,
    ...base.components,
    schemas: {
      ...generated.components?.schemas,
      ...base.components?.schemas,
    },
  },
};

await writeFile(outputPath, `${JSON.stringify(merged, null, 2)}\n`);
