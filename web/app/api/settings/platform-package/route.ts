import { authorizePackaging, packageFailure, packageResponse, packageState, readPackageInput, startPackageJob } from "@/features/settings/server/platform-packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { await authorizePackaging(request); return packageResponse(await packageState()); }
  catch (error) { return packageFailure(error); }
}

export async function POST(request: Request) {
  try {
    await authorizePackaging(request);
    return packageResponse(await startPackageJob(await readPackageInput(request)));
  } catch (error) { return packageFailure(error); }
}
