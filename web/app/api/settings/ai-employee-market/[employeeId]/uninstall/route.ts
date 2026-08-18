import { proxyBackendJson } from "../../../../_lib/backend-json-proxy";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  const { employeeId } = await params;
  return proxyBackendJson(
    request,
    `/api/settings/ai-employee-market/${encodeURIComponent(employeeId)}/uninstall`,
  );
}
