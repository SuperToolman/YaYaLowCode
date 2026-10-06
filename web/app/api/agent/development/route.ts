import { NextResponse } from "next/server";
import {
  applyPatch,
  getAutomationCatalog,
  getAutomationNodeManifest,
  getComponentCatalog,
  getComponentManifest,
  validateAutomationNode,
  validateComponentField,
  type PatchOperation,
} from "@/app/lib/agent-development-contracts";

export const dynamic = "force-dynamic";

type DevelopmentRequest = {
  operation?: string;
  field?: unknown;
  kind?: string;
  config?: unknown;
  context?: unknown;
  base?: unknown;
  patch?: unknown;
  baseVersion?: number;
};

function error(message: string, status = 400) {
  return NextResponse.json({ code: status, message }, { status });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") ?? "catalog";
  const type = url.searchParams.get("type");
  if (resource === "components") return NextResponse.json({ code: 0, data: { items: getComponentCatalog() } });
  if (resource === "automation") return NextResponse.json({ code: 0, data: { items: getAutomationCatalog() } });
  if (resource === "component-contract") {
    const manifest = type ? getComponentManifest(type) : undefined;
    return manifest ? NextResponse.json({ code: 0, data: manifest }) : error("component contract not found", 404);
  }
  if (resource === "automation-contract") {
    const manifest = type ? getAutomationNodeManifest(type) : undefined;
    return manifest ? NextResponse.json({ code: 0, data: manifest }) : error("automation node contract not found", 404);
  }
  return NextResponse.json({ code: 0, data: { components: getComponentCatalog(), automation: getAutomationCatalog() } });
}

export async function POST(request: Request) {
  let body: DevelopmentRequest;
  try {
    body = await request.json() as DevelopmentRequest;
  } catch {
    return error("invalid JSON body");
  }
  if (body?.operation === "validate-component") {
    const field = (body.field ?? {}) as Parameters<typeof validateComponentField>[0];
    const issues = validateComponentField(field);
    return NextResponse.json({ code: 0, data: { valid: issues.length === 0, issues } });
  }
  if (body?.operation === "validate-automation") {
    const issues = validateAutomationNode(body.kind ?? "", body.config, body.context as Parameters<typeof validateAutomationNode>[2]);
    return NextResponse.json({ code: 0, data: { valid: issues.length === 0, issues } });
  }
  if (body?.operation === "preview-patch") {
    if (!Array.isArray(body.patch) || body.base === undefined) return error("base and patch are required");
    try {
      const preview = applyPatch(body.base, body.patch as PatchOperation[]);
      return NextResponse.json({ code: 0, data: { baseVersion: body.baseVersion ?? null, patch: body.patch, preview } });
    } catch (cause) {
      return error(cause instanceof Error ? cause.message : "invalid patch");
    }
  }
  return error("unsupported development operation");
}
