import { authorizePackaging, downloadPackage, packageFailure } from "@/features/settings/server/platform-packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await authorizePackaging(request); return await downloadPackage((await params).id, new URL(request.url).searchParams.get("check") === "true"); }
  catch (error) { return packageFailure(error); }
}
