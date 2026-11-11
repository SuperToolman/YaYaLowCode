import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Include type references for boundaries, but exclude them from runtime graphs. */
export function sourceDependencies(source, filename) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const dependencies = [];
  function add(node, specifier, typeOnly = false, dynamic = false) {
    dependencies.push({ specifier, typeOnly, dynamic, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typeOnly = !!clause && (clause.isTypeOnly || !clause.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(element => element.isTypeOnly));
      add(node, node.moduleSpecifier.text, !!typeOnly);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      const typeOnly = node.isTypeOnly || clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every(element => element.isTypeOnly);
      add(node, node.moduleSpecifier.text, !!typeOnly);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) add(node, node.argument.literal.text, true);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require") && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) add(node, node.arguments[0].text, false, true);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return dependencies;
}

export function dependencyTarget(specifier, filename) {
  return specifier.startsWith("@/") ? path.posix.normalize(specifier.slice(2))
    : specifier.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(filename), specifier)) : null;
}

export function dependencyCycles(vertices, edges) {
  const graph = new Map([...vertices].sort().map(vertex => [vertex, []]));
  for (const edge of edges) if (graph.has(edge.from) && graph.has(edge.to)) graph.get(edge.from).push(edge.to);
  const indices = new Map(), low = new Map(), stack = [], active = new Set(), groups = [];
  let nextIndex = 0;
  function visit(vertex) {
    indices.set(vertex, nextIndex); low.set(vertex, nextIndex++); stack.push(vertex); active.add(vertex);
    for (const target of graph.get(vertex)) {
      if (!indices.has(target)) { visit(target); low.set(vertex, Math.min(low.get(vertex), low.get(target))); }
      else if (active.has(target)) low.set(vertex, Math.min(low.get(vertex), indices.get(target)));
    }
    if (low.get(vertex) !== indices.get(vertex)) return;
    const group = [];
    let target;
    do { target = stack.pop(); active.delete(target); group.push(target); } while (target !== vertex);
    if (group.length > 1 || graph.get(vertex).includes(vertex)) groups.push(group.sort());
  }
  for (const vertex of graph.keys()) if (!indices.has(vertex)) visit(vertex);
  return groups.sort((left, right) => left[0].localeCompare(right[0]));
}

export function collectSourceGraph(root) {
  const sources = new Map();
  const errors = [];
  function walk(directory) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const filename = `${directory}/${entry.name}`;
      if (filename === "shared/lib/api-client") continue;
      if (entry.isDirectory()) {
        if (["node_modules", ".cache", ".next"].includes(entry.name)) { errors.push(`Generated directory inside source: ${filename}`); continue; }
        walk(filename);
      } else if (/\.[cm]?[jt]sx?$/.test(filename)) sources.set(filename, readFileSync(path.join(root, filename), "utf8"));
    }
  }
  for (const directory of ["app", "features", "shared"]) walk(directory);
  const edges = [];
  for (const [filename, source] of sources) {
    for (const dependency of sourceDependencies(source, filename)) {
      const candidate = dependencyTarget(dependency.specifier, filename);
      if (!candidate) continue;
      let target = null;
      for (const suffix of ["", ".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx", "/index.ts", "/index.tsx"]) {
        if (sources.has(candidate + suffix)) { target = candidate + suffix; break; }
      }
      if (target) edges.push({ from: filename, to: target, ...dependency });
      else if (!existsSync(path.join(root, candidate)) && !candidate.startsWith("shared/lib/api-client/") && !/\.(css|json|svg|png|jpe?g|webp)$/.test(candidate)) errors.push(`${filename}:${dependency.line}: unresolved local module ${dependency.specifier}`);
    }
  }
  return { sources, edges, errors };
}

export function graphBoundaryErrors(sources, edges) {
  const production = new Set([...sources.keys()].filter(filename => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(filename)));
  const runtimeEdges = edges.filter(edge => production.has(edge.from) && production.has(edge.to) && !edge.typeOnly);
  const errors = dependencyCycles(production, runtimeEdges).map(group => `Runtime dependency cycle: ${group.join(" <-> ")}`);
  const owner = filename => filename.startsWith("features/") ? filename.split("/").slice(0, 2).join("/") : null;
  const modules = new Set([...production].map(owner).filter(Boolean));
  const domainEdges = runtimeEdges.filter(edge => owner(edge.from) && owner(edge.to) && owner(edge.from) !== owner(edge.to)).map(edge => ({ from: owner(edge.from), to: owner(edge.to) }));
  errors.push(...dependencyCycles(modules, domainEdges).map(group => `Feature dependency cycle: ${group.join(" <-> ")}`));
  return errors;
}
