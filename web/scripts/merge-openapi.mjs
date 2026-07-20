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

const merged = {
  ...generated,
  paths: {
    ...generated.paths,
    ...base.paths,
  },
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
