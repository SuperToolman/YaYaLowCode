import { proxyBackendJson } from "../../../_lib/backend-json-proxy";

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
