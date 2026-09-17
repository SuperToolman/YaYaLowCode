import { NextResponse } from "next/server";

import { backendBaseUrl } from "../../dingtalk-lib";

export async function POST(request: Request) {
  let body: { mobile?: string };
  try { body = await request.json() as { mobile?: string }; } catch { return error("请求参数格式不正确", 400); }
  const mobile = body.mobile?.trim() ?? "";
  if (!mobile) return error("请输入手机号", 400);
  const response = await fetch(`${backendBaseUrl}/api/identity/sms/send-code`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mobile }), cache: "no-store",
  });
  const result = await response.json().catch(() => null) as { code?: number; message?: string; data?: unknown } | null;
  if (!response.ok || result?.code !== 0) return error(result?.message || "验证码发送失败", response.status || 502);
  return NextResponse.json(result);
}

function error(message: string, status: number) { return NextResponse.json({ code: status, message, data: null }, { status }); }
