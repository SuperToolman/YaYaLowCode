import { proxyBackendJson } from "../../../../../_lib/backend-json-proxy";

type Context = {
  params: Promise<{ appId: string; groupId: string }>;
};

function groupPath(appId: string, groupId: string) {
  return `/api/apps/${encodeURIComponent(appId)}/navigation/groups/${encodeURIComponent(groupId)}`;
}

export async function PATCH(request: Request, { params }: Context) {
  const { appId, groupId } = await params;
  return proxyBackendJson(request, groupPath(appId, groupId));
}

export async function DELETE(request: Request, { params }: Context) {
  const { appId, groupId } = await params;
  return proxyBackendJson(request, groupPath(appId, groupId));
}
