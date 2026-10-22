import { NextResponse } from "next/server";

import { createLoginResponse } from "../../_lib";
import { verifySmsCode } from "@lib/http";
import { createBackendSdkClient } from "@lib/backend-client";

export async function POST(request: Request) {
  let body: { mobile?: string; code?: string };
  try { body = await request.json() as { mobile?: string; code?: string }; } catch { return error("请求参数格式不正确", 400); }
  const mobile = body.mobile?.trim() ?? "";
  const code = body.code?.trim() ?? "";
  if (!mobile || !code) return error("请输入手机号和验证码", 400);
  if (process.env.NODE_ENV === "production" && !process.env.AUTH_TOKEN_SECRET) return error("登录服务尚未完成生产环境配置", 503);
  const result = await verifySmsCode({ client: createBackendSdkClient(request), body: { mobile, code } });
  if (result.error || result.data?.code !== 0 || !result.data.data) {
    const detail = result.error && typeof result.error === "object" && "message" in result.error ? String(result.error.message) : result.data?.message;
    return error(detail || "验证码错误或已过期", result.response?.status ?? 503);
  }
  return createLoginResponse(result.data.data);
}

function error(message: string, status: number) { return NextResponse.json({ code: status, message, data: null }, { status }); }
