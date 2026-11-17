import { authorizePackaging, packageFailure, packageResponse, readPackageJob } from "@/features/settings/server/platform-packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await authorizePackaging(request); return packageResponse(await readPackageJob((await params).id)); }
  catch (error) { return packageFailure(error); }
}
