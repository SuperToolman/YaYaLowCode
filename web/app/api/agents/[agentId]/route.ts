import { deleteAgent, updateAgent } from "../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../_lib/backend-sdk-client";

export async function PUT(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return sdkJsonResponse(updateAgent({ client: createBackendSdkClient(request), path: { id: agentId }, body: await request.json() }));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return sdkJsonResponse(deleteAgent({ client: createBackendSdkClient(request), path: { id: agentId } }));
}
