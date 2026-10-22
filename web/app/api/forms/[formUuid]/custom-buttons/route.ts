import { createCustomButton, listCustomButtons } from "@/app/lib/http";
import { createBackendSdkClient, sdkJsonResponse } from "../../../_lib/backend-sdk-client";

type Context = { params: Promise<{ formUuid: string }> };

export async function GET(request: Request, { params }: Context) {
  const { formUuid } = await params;
  const searchParams = new URL(request.url).searchParams;
  return sdkJsonResponse(listCustomButtons({
    client: createBackendSdkClient(request),
    path: { formUuid },
    query: {
      search: searchParams.get("search") ?? undefined,
      page: Number(searchParams.get("page") ?? 1),
      pageSize: Number(searchParams.get("pageSize") ?? 20),
    },
  }));
}

export async function POST(request: Request, { params }: Context) {
  return sdkJsonResponse(createCustomButton({
    client: createBackendSdkClient(request),
    path: await params,
    body: await request.json(),
  }));
}
