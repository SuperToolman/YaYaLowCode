import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceDependencies, dependencyTarget, collectSourceGraph, graphBoundaryErrors } from "./source-dependencies.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export function checkSource(source, filename) {
  const errors = [];
  const test = /\.test\.[cm]?[jt]sx?$/.test(filename);
  function check(specifier) {
    if (/^@(app|features|components|global-components|shared|lib)\//.test(specifier)) {
      errors.push(`${filename}: use the single @/ alias: ${specifier}`);
    }
    const target = dependencyTarget(specifier, filename);
    if (!target) return;
    if (/^(app\/(?:lib|components)|components|features\/shared)(?:\/|$)/.test(target)) {
      errors.push(`${filename}: retired source directory: ${specifier}`);
    }
    // Integration tests may assemble routes and features together.
    if (test) return;
    if (filename.startsWith("shared/") && /^(app|features)\//.test(target)) {
      errors.push(`${filename}: shared must not depend on app or features: ${specifier}`);
    }
    if (filename.startsWith("features/") && target.startsWith("app/")) {
      errors.push(`${filename}: features must not depend on app: ${specifier}`);
    }
    if (filename.startsWith("features/form-model/") && target.startsWith("features/") && !target.startsWith("features/form-model/")) {
      errors.push(`${filename}: form contracts must not depend on business implementations: ${specifier}`);
    }
    if (/^features\/(?:form-controls|conditions)\//.test(filename) && /^features\/(?:form-designer|form-runtime|records|custom-buttons|automation-editor)\//.test(target)) {
      errors.push(`${filename}: foundational controls and rules must not depend on consuming features: ${specifier}`);
    }
  }
  for (const dependency of sourceDependencies(source, filename)) check(dependency.specifier);
  return errors;
}

export function checkStructure(projectRoot = root) {
  const errors = [];
  for (const retired of ["app/lib", "app/components", "components", "features/shared", "packages", "web"]) {
    if (existsSync(path.join(projectRoot, retired))) errors.push(`Retired directory still exists: ${retired}`);
  }
  const { sources, edges, errors: graphErrors } = collectSourceGraph(projectRoot);
  errors.push(...graphErrors);
  for (const [filename, source] of sources) errors.push(...checkSource(source, filename));
  errors.push(...graphBoundaryErrors(sources, edges));
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkStructure();
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log("Structure boundaries checked.");
}
