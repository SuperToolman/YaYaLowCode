import { NextResponse } from "next/server";
import { shouldUseSecureCookie, verifyAuthToken } from "../_lib";
import { NextRequest } from "next/server";
import { logoutOperationsAccess } from "@/shared/lib/http";
import { createBackendSdkClient } from "@/shared/lib/backend-client";

export async function POST(request: NextRequest) {
  const token = request.cookies.get("yaya-auth-token")?.value;
  if (token && verifyAuthToken(token)?.operations_session) {
    try {
      await logoutOperationsAccess({ client: createBackendSdkClient(request), signal: AbortSignal.timeout(10_000) });
    } catch { /* The cookie is always cleared; remote sessions also expire automatically. */ }
  }
  const response = NextResponse.json({ code: 0, message: "已退出登录", data: null });
  response.cookies.set("yaya-auth-token", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: 0,
  });
  return response;
}
