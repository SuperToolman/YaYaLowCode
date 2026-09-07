import { proxyBackendJson } from "../../../_lib/backend-json-proxy";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ formUuid: string }> },
) {
  const { formUuid } = await params;
  const query = new URL(request.url).search;
  return proxyBackendJson(
    request,
    `/api/forms/${encodeURIComponent(formUuid)}/detail-forms${query}`,
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ formUuid: string }> },
) {
  const { formUuid } = await params;
  return proxyBackendJson(
    request,
    `/api/forms/${encodeURIComponent(formUuid)}/detail-forms`,
  );
}
