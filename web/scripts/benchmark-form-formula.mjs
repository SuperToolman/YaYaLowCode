// CPU microbenchmark only: these numbers are not browser frame rates or interaction latency.
// node scripts/benchmark-form-formula.mjs [optional-baseline-source-path]
import fs from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import ts from "typescript";

function load(sourcePath) {
  const code = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  new Function("module", "exports", code)(compiled, compiled.exports);
  return compiled.exports.calculateFormulaValues;
}
const current = load("features/form-runtime/model/form-formula.ts");
const baseline = process.argv[2] ? load(process.argv[2]) : undefined;
const field = (id, formula) => ({ id, label: id, type: "number", row: 0, column: 0,
  props: formula ? { defaultValueType: "formula", defaultValueFormula: formula } : {} });
const fixtures = [
  ...[50, 150, 300].map((count) => ({ name: `${count}-plain`, fields: Array.from({ length: count }, (_, i) => field(`f${i}`)), source: "f0" })),
  { name: "100-reverse-chain", source: "source", fields: [
    ...Array.from({ length: 100 }, (_, i) => field(`f${i}`, i ? `$f${i - 1}+1` : "$source+1")).reverse(), field("source"),
  ] },
  { name: "100-branches", source: "source", fields: [
    field("source"), ...Array.from({ length: 100 }, (_, i) => field(`f${i}`, `$source+${i}`)),
  ] },
];
function sample(calculate, fixture) {
  let values = Object.fromEntries(fixture.fields.map((f) => [f.id, 0]));
  for (let i = 0; i < 20; i++) values = calculate(fixture.fields, { ...values, [fixture.source]: i }, { changedFieldIds: [fixture.source] }).values;
  const samples = [];
  for (let i = 20; i < 220; i++) {
    const input = { ...values, [fixture.source]: i };
    const start = performance.now();
    values = calculate(fixture.fields, input, { changedFieldIds: [fixture.source] }).values;
    samples.push(performance.now() - start);
  }
  if (fixture.name === "100-reverse-chain" && values.f99 !== 319) throw new Error("Incorrect formula result");
  samples.sort((a, b) => a - b);
  return { p50_ms: +samples[100].toFixed(4), p95_ms: +samples[190].toFixed(4) };
}
const results = fixtures.map((fixture) => {
  const before = baseline ? sample(baseline, fixture) : undefined;
  const after = sample(current, fixture);
  return { fixture: fixture.name, before, after,
    p95_reduction_percent: before ? +((1 - after.p95_ms / before.p95_ms) * 100).toFixed(1) : undefined };
});
console.log(JSON.stringify({ node: process.version, cpu: os.cpus()[0].model, platform: `${os.platform()} ${os.arch()}`,
  warmup: 20, samples: 200, unit: "milliseconds, Node CPU only", results }, null, 2));
