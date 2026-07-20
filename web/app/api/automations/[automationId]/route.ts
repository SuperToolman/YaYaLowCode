import { proxyBackendJson } from "../../_lib/backend-json-proxy";

export async function GET(
  request: Request,
  context: { params: Promise<{ automationId: string }> },
) {
  const { automationId } = await context.params;

  return proxyBackendJson(request, `/api/automations/${encodeURIComponent(automationId)}`);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ automationId: string }> },
) {
  const { automationId } = await context.params;

  return proxyBackendJson(request, `/api/automations/${encodeURIComponent(automationId)}`);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ automationId: string }> },
) {
  const { automationId } = await context.params;

  return proxyBackendJson(request, `/api/automations/${encodeURIComponent(automationId)}`);
}
