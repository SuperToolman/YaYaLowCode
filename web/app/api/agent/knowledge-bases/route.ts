import { createKnowledgeBase, listKnowledgeBases } from "../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../_lib/backend-sdk-client";
export async function GET(request: Request) { return sdkJsonResponse(listKnowledgeBases({ client: createBackendSdkClient(request) })); }
export async function POST(request: Request) { return sdkJsonResponse(createKnowledgeBase({ client: createBackendSdkClient(request), body: await request.json() })); }
