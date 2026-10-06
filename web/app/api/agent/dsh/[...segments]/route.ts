import {
  proxyAgentRuntimeJson,
  proxyAgentRuntimeStream,
} from "@/app/api/_lib/agent-runtime-proxy";

type Context = { params: Promise<{ segments: string[] }> };

function runtimePath(segments: string[]) {
  return `/api/agent/dsh/${segments.map(encodeURIComponent).join("/")}`;
}

export async function POST(request: Request, { params }: Context) {
  const { segments } = await params;
  return proxyAgentRuntimeJson(request, runtimePath(segments));
}

export async function GET(request: Request, { params }: Context) {
  const { segments } = await params;
  const path = runtimePath(segments);
  if (segments.join("/") === "events.mux") {
    return proxyAgentRuntimeStream(request, path);
  }
  return proxyAgentRuntimeJson(request, path);
}
