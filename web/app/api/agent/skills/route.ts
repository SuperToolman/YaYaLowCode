import { createSkill, listSkills } from "../../../lib/api-client";
import { createBackendSdkClient, sdkJsonResponse } from "../../_lib/backend-sdk-client";
export async function GET(request: Request) { return sdkJsonResponse(listSkills({ client: createBackendSdkClient(request) })); }
export async function POST(request: Request) { return sdkJsonResponse(createSkill({ client: createBackendSdkClient(request), body: await request.json() })); }
