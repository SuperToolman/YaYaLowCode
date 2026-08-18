import { proxyBackendJson } from "../../../../_lib/backend-json-proxy";

export async function PUT(
  request: Request,
  context: { params: Promise<{ employeeId: string }> },
) {
  const { employeeId } = await context.params;
  return proxyBackendJson(
    request,
    `/api/settings/ai-employees/configurations/${encodeURIComponent(employeeId)}`,
  );
}
