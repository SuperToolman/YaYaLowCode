import { proxyBackendJson } from "../../../../_lib/backend-json-proxy";

type Context = { params: Promise<{ notificationUuid: string }> };

export async function POST(request: Request, { params }: Context) {
  const { notificationUuid } = await params;
  return proxyBackendJson(request, `/api/workflow/notifications/${encodeURIComponent(notificationUuid)}/read`);
}
