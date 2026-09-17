import { NextResponse } from "next/server";

import { createLoginResponse } from "../../_lib";
import { backendBaseUrl } from "../../dingtalk-lib";

export async function POST(request: Request) {
  let body: { mobile?: string; code?: string };
  try { body = await request.json() as { mobile?: string; code?: string }; } catch { return error("请求参数格式不正确", 400); }
  const mobile = body.mobile?.trim() ?? "";
  const code = body.code?.trim() ?? "";
  if (!mobile || !code) return error("请输入手机号和验证码", 400);
  if (process.env.NODE_ENV === "production" && !process.env.AUTH_TOKEN_SECRET) return error("登录服务尚未完成生产环境配置", 503);
  const response = await fetch(`${backendBaseUrl}/api/identity/sms/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mobile, code }), cache: "no-store",
  });
  const result = await response.json().catch(() => null) as { code?: number; message?: string; data?: { id: string; username: string; displayName: string } | null } | null;
  if (!response.ok || result?.code !== 0 || !result.data) return error(result?.message || "验证码错误或已过期", response.status || 401);
  return createLoginResponse(result.data);
}

function error(message: string, status: number) { return NextResponse.json({ code: status, message, data: null }, { status }); }
