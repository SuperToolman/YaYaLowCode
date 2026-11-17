import { NextResponse } from "next/server";
import { createLoginResponse } from "../_lib";
import { exchangeOperationsAccess } from "@/shared/lib/http";
import { createBackendSdkClient } from "@/shared/lib/backend-client";

export async function POST(request: Request) {
  // The one-time credential is submitted in a same-origin body, never a URL query.
  if (request.headers.get("origin") !== new URL(request.url).origin &&
      request.headers.get("origin") !== `${new URL(request.url).protocol}//${request.headers.get("host")}`) {
    return NextResponse.json({ code: 403, message: "登录来源不受信任", data: null }, { status: 403 });
  }
  let code: unknown;
  try { code = (await request.json()).code; } catch { /* validated below */ }
  if (typeof code !== "string" || !/^[a-f0-9]{64}$/.test(code)) {
    return NextResponse.json({ code: 400, message: "运维凭证格式无效", data: null }, { status: 400 });
  }
  if (process.env.NODE_ENV === "production" && !process.env.AUTH_TOKEN_SECRET) {
    return NextResponse.json({ code: 503, message: "认证服务未完成配置", data: null }, { status: 503 });
  }
  try {
    const result = await exchangeOperationsAccess({ client: createBackendSdkClient(request), body: { code }, signal: AbortSignal.timeout(15_000) });
    if (result.error || result.data?.code !== 0 || !result.data.data) {
      const detail = result.error && typeof result.error === "object" && "message" in result.error ? String(result.error.message) : result.data?.message;
      const status = result.response?.status ?? 503;
      return NextResponse.json({ code: status, message: detail || "运维认证失败", data: null }, { status: status >= 400 ? status : 403 });
    }
    const user = result.data.data;
    return createLoginResponse({ id: user.id, username: user.username, displayName: user.displayName }, { session: user.operationsSession, actor: user.operationsActor, expiresAt: user.expiresAt });
  } catch {
    return NextResponse.json({ code: 503, message: "运维认证服务不可用，请重新从运营平台进入", data: null }, { status: 503 });
  }
}
