// @vitest-environment node
import { expect, it } from "vitest";
import { checkSource } from "./check-structure.mjs";
import { sourceDependencies, dependencyCycles, graphBoundaryErrors } from "./source-dependencies.mjs";

it("rejects upward dependencies through relative and dynamic imports", () => {
  expect(checkSource('import type { User } from "../../features/auth/types";', "shared/lib/user.ts")).toHaveLength(1);
  expect(checkSource('const page = import("@/app/_components/HomePageClient");', "features/application/page.ts")).toHaveLength(1);
});

it("accepts downward dependencies and explicit integration tests", () => {
  expect(checkSource('export { notify } from "@/shared/lib/notify";', "features/auth/api.ts")).toEqual([]);
  expect(checkSource('import { GET } from "@/app/api/auth/session/route";', "features/auth/api.test.ts")).toEqual([]);
});

it("rejects retired aliases and directories even in tests", () => {
  expect(checkSource('import { useAuth } from "@components/AuthProvider";', "features/auth/api.test.ts")).toHaveLength(1);
  expect(checkSource('import { request } from "@/app/lib/http";', "app/page.tsx")).toHaveLength(1);
});

it("checks inline import types and normalized relative paths", () => {
  expect(checkSource('type Page = import("@/app/page").default;', "features/auth/types.ts")).toHaveLength(1);
  expect(checkSource('export type Page = import("../../app/page").default;', "shared/lib/types.ts")).toHaveLength(1);
  expect(checkSource('import { Page } from "@/features/../app/page";', "features/auth/types.ts")).toHaveLength(1);
});

it("keeps form contracts and reusable rules independent of consuming features", () => {
  expect(checkSource('import type { Field } from "@/features/form-runtime/components";', "features/form-model/types.ts")).toHaveLength(1);
  expect(checkSource('import { FieldSelect } from "@/features/form-designer/components/FieldSelect";', "features/conditions/Editor.tsx")).toHaveLength(1);
});

it("distinguishes explicit type edges from static and lazy value dependencies", () => {
  const dependencies = sourceDependencies([
    'import type { A } from "./a";',
    'import { type B } from "./b";',
    'export type { C } from "./c";',
    'type D = import("./d").D;',
    'import { type E, value } from "./e";',
    'const lazy = import("./f");',
  ].join("\n"), "features/example.ts");
  expect(dependencies.map(dependency => dependency.typeOnly)).toEqual([true, true, true, true, false, false]);
  expect(dependencies.at(-1)?.dynamic).toBe(true);
});

it("finds multi-file and lazy cycles without reporting a diamond as a cycle", () => {
  expect(dependencyCycles(new Set(["a", "b", "c", "d"]), [
    { from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" },
  ])).toEqual([]);
  expect(dependencyCycles(new Set(["a", "b", "c"]), [
    { from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" },
  ])).toEqual([["a", "b", "c"]]);
});

it("checks domain cycles even when separate files do not form a file cycle", () => {
  const sources = new Map([
    ["features/a/first.ts", ""], ["features/a/second.ts", ""], ["features/b/first.ts", ""], ["features/b/second.ts", ""],
    ["features/a/integration.test.ts", ""],
  ]);
  const edges = [
    { from: "features/a/first.ts", to: "features/b/first.ts", typeOnly: false, dynamic: true },
    { from: "features/b/second.ts", to: "features/a/second.ts", typeOnly: true },
  ];
  expect(graphBoundaryErrors(sources, edges)).toEqual([]);
  expect(graphBoundaryErrors(sources, [...edges, { from: "features/b/second.ts", to: "features/a/second.ts", typeOnly: false }])).toEqual([
    "Feature dependency cycle: features/a <-> features/b",
  ]);
  expect(graphBoundaryErrors(sources, [
    { from: "features/a/integration.test.ts", to: "features/b/first.ts", typeOnly: false },
    { from: "features/b/first.ts", to: "features/a/integration.test.ts", typeOnly: false },
  ])).toEqual([]);
});
