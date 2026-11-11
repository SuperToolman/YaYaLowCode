import { NextResponse } from "next/server";
import { backendBaseUrl, backendAuthorizationHeaders, proxyBackendJson, proxyBackendFile } from "@/app/api/_lib/backend-json-proxy";

type Context = { params: Promise<{ segments: string[] }> };
export const dynamic = "force-dynamic";

function pathFor(segments: string[]) {
  return `/api/agent/v2/${segments.map(encodeURIComponent).join("/")}`;
}

export async function GET(request: Request, { params }: Context) {
  const { segments } = await params;
  const url = new URL(request.url);
  const path = `${pathFor(segments)}${url.search}`;
  if (segments.length === 4 && segments[0] === "sessions" && segments[2] === "files") return proxyBackendFile(request, path);
  if (segments.length !== 3 || segments[0] !== "sessions" || segments[2] !== "events") return proxyBackendJson(request, path);
  try {
    const lastEventId = request.headers.get("last-event-id");
    const response = await fetch(`${backendBaseUrl}${path}`, {
      headers: { ...backendAuthorizationHeaders(request), accept: "text/event-stream", ...(lastEventId ? { "last-event-id": lastEventId } : {}) },
      cache: "no-store", signal: request.signal,
    });
    return new Response(response.body, { status: response.status, headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "cache-control": "private, no-cache, no-transform", "x-accel-buffering": "no",
    } });
  } catch {
    return NextResponse.json({ code: 503, message: "AgentV2 服务暂时不可用" }, { status: 503 });
  }
}

export async function POST(request: Request, { params }: Context) {
  return proxyBackendJson(request, pathFor((await params).segments));
}

export async function PUT(request: Request, { params }: Context) {
  const segments = (await params).segments;
  if (segments.length === 4 && segments[0] === "submissions" && segments[2] === "attachments") return proxyBackendFile(request, pathFor(segments), 8 * 1024 * 1024);
  return NextResponse.json({ message: "unsupported upload route" }, { status: 404 });
}
export async function DELETE(request: Request, { params }: Context) {
  return proxyBackendJson(request, pathFor((await params).segments));
}

export async function PATCH(request: Request, { params }: Context) {
  const segments = (await params).segments;
  if (segments.length !== 2 || segments[0] !== "sessions") return NextResponse.json({ message: "unsupported session route" }, { status: 404 });
  return proxyBackendJson(request, pathFor(segments));
}
