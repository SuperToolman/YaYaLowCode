// Build-time only: extract real designer types/defaults. Rust embeds the artifact;
// no Node, TypeScript parser or frontend source is needed by the deployed API.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const designer = "features/form-designer/editor/components/CompTool.tsx";
const automation = "features/automation-editor/model/editor-types.ts";
const sourcePaths = [designer, automation, "features/form-model/form-component-contracts.ts", "features/form-model/cascader-data-source.ts", "features/form-model/runtime-types.ts"];
const configFile = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const program = ts.createProgram(sourcePaths.map(p => path.join(root, p)), { ...config.options, noEmit: true });
const checker = program.getTypeChecker();
const source = name => program.getSourceFile(path.join(root, name));
const aliases = (name, type) => {
  const node = source(name).statements.find(n => ts.isTypeAliasDeclaration(n) && n.name.text === type);
  if (!node) throw new Error(`Missing type ${name}:${type}`);
  return checker.getTypeFromTypeNode(node.type);
};
const definitions = {};
const seen = new Map();
const unresolved = new Set();
function schema(t) {
  const f = ts.TypeFlags;
  if (t.flags & f.StringLiteral || t.flags & f.NumberLiteral) return { const: t.value };
  if (t.flags & f.BooleanLiteral) return { const: t.intrinsicName === "true" };
  if (t.flags & f.String) return { type: "string" };
  if (t.flags & f.Number) return { type: "number" };
  if (t.flags & f.Boolean) return { type: "boolean" };
  if (t.flags & f.Null) return { type: "null" };
  if (t.isUnion()) {
    const members = t.types.filter(x => !(x.flags & (f.Undefined | f.Never)));
    return members.length === 1 ? schema(members[0]) : { anyOf: members.map(schema) };
  }
  if (t.flags & (f.Any | f.Unknown)) {
    unresolved.add(checker.typeToString(t));
    return { description: "Product source leaves this value unconstrained; semantic validation still required." };
  }
  if (checker.isArrayType(t)) return { type: "array", items: schema(checker.getTypeArguments(t)[0]) };
  if (t.flags & f.Object) {
    if (seen.has(t)) return { $ref: `#/$defs/${seen.get(t)}` };
    const name = `type${seen.size + 1}`;
    seen.set(t, name);
    const properties = {}, required = [];
    definitions[name] = {};
    for (const p of checker.getPropertiesOfType(t)) {
      properties[p.name] = schema(checker.getTypeOfSymbolAtLocation(p, p.valueDeclaration ?? p.declarations[0]));
      if (!(p.flags & ts.SymbolFlags.Optional)) required.push(p.name);
    }
    definitions[name] = { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
    return { $ref: `#/$defs/${name}` };
  }
  throw new Error(`Unsupported product type: ${checker.typeToString(t)}`);
}

// Evaluate only selected, repository-owned pure declarations at export time.
function pure(name, selected, bindings = {}) {
  const sf = source(name);
  const statements = sf.statements.filter(n => selected === "all"
    ? !ts.isImportDeclaration(n)
    : ts.isFunctionDeclaration(n) ? selected.includes(n.name?.text)
      : ts.isVariableStatement(n) && n.declarationList.declarations.some(d => selected.includes(d.name.getText(sf))));
  const names = statements.flatMap(n => ts.isFunctionDeclaration(n) ? [n.name.text] : ts.isVariableStatement(n) ? n.declarationList.declarations.map(d => d.name.getText(sf)) : []);
  const code = ts.transpileModule(statements.map(n => n.getText(sf).replace(/^export\s+/, "")).join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ exports: {}, ...bindings });
  return vm.runInContext(`${code}\n;({${names.join(",")}})`, context, { timeout: 5000 });
}
const cascader = pure("features/form-model/cascader-data-source.ts", "all");
const defaults = pure(designer, ["DESIGNER_COMPONENTS", "DEFAULT_OPTIONS", "DEFAULT_MEMBER_OPTIONS", "DEFAULT_DEPARTMENT_OPTIONS", "getDesignerComponent", "getDefaultOptions", "getDefaultDesignerFieldProps"], cascader);
const manifests = pure("features/form-model/form-component-contracts.ts", "all").COMPONENT_MANIFESTS;
const designerProps = schema(aliases(designer, "DesignerFieldProps"));
const runtimeProps = schema(aliases("features/form-model/runtime-types.ts", "RuntimeFieldProps"));
const components = defaults.DESIGNER_COMPONENTS.map(c => {
  const manifest = manifests[c.type];
  return {
    id: c.type, label: c.label, category: c.group, version: 1,
    supportedFormTypes: ["html", "tsx"].includes(c.type) ? ["defined"] : ["normal", "workflow"],
    designWriteSupported: !["html", "tsx"].includes(c.type),
    defaults: defaults.getDefaultDesignerFieldProps(c.type),
    defaultPropertyNames: Object.keys(defaults.getDefaultDesignerFieldProps(c.type)),
    propsSchema: designerProps, runtimePropsSchema: runtimeProps,
    coverage: "Designer-wide property types and exact per-component defaults. Not every generic property applies to this component. Component-specific semantic coverage is partial; API validation is required and is not a runtime test.",
    ...(manifest ? { propertyEditors: manifest.designerSchema, guidance: manifest.agent } : {}),
  };
});
const nodeTypes = {
  trigger: "TriggerConfig", condition: "ConditionConfig", "parallel-condition": "ConditionConfig",
  "get-one": "GetDataConfig", "get-many": "GetDataConfig", "add-data": "AddDataConfig",
  "update-data": "ActionConfig", "delete-data": "ActionConfig", "http-request": "ActionConfig",
  "initiate-approval": "InitiateApprovalConfig", approval: "AssigneeConfig", executor: "AssigneeConfig", copy: "CopyConfig",
};
const nodeSources = { ...nodeTypes };
const nodes = Object.entries(nodeTypes).map(([id, name]) => ({ id, configSchema: schema(aliases(automation, name)), sourceType: nodeSources[id], coverage: "Typed editor configuration; API semantic validation is additionally required. Not a guarantee of runtime success.", supportedFlowTypes: ["approval", "executor", "copy"].includes(id) ? ["process"] : ["trigger", "process"] }));
// Hash extracted product data, not transitive React/UI files: cosmetic edits must
// not invalidate active design tasks. Imported property types are included in $defs.
const product = { componentContractVersion: 1, components, nodes, $defs: definitions, limitations: [...unresolved].map(t => `Unconstrained source type: ${t}`) };
const sourceHash = crypto.createHash("sha256").update(JSON.stringify(product)).digest("hex");
const payload = { formatVersion: 1, sourceHash, ...product };
const output = path.resolve(root, "../api/src/modules/development_contracts/catalog.generated.json");
const content = JSON.stringify(payload, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (!fs.existsSync(output) || fs.readFileSync(output, "utf8") !== content) throw new Error("Development contracts are stale; run node scripts/export-development-contracts.mjs in web");
} else { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, content); }
console.log(`Development contracts: ${components.length} components, ${nodes.length} node types; ${Buffer.byteLength(content)} bytes; ${process.argv.includes("--check") ? "current" : "exported"}`);
