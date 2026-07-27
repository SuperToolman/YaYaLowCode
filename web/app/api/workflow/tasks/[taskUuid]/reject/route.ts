import { proxyBackendJson } from "../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ taskUuid: string }> };

export async function POST(request: Request, { params }: Context) {
  const { taskUuid } = await params;
  return proxyBackendJson(request, `/api/workflow/tasks/${encodeURIComponent(taskUuid)}/reject`);
}
