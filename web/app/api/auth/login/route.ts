import { NextResponse } from "next/server";
import { createLoginResponse } from "../_lib";
import { backendBaseUrl } from "../dingtalk-lib";

type LoginRequest = {
  username?: string;
  password?: string;
};

export async function POST(request: Request) {
  let payload: LoginRequest;

  try {
    payload = (await request.json()) as LoginRequest;
  } catch {
    return errorResponse("登录参数格式不正确", 400);
  }

  const username = payload.username?.trim() ?? "";
  const password = payload.password ?? "";
  if (!username || !password) return errorResponse("请输入账号和密码", 400);

  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && !process.env.AUTH_TOKEN_SECRET) {
    return errorResponse("登录服务尚未完成生产环境配置", 503);
  }

  const response = await fetch(`${backendBaseUrl}/api/identity/local-login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }), cache: "no-store" });
  const result = (await response.json()) as { code: number; message: string; data: { id: string; username: string; displayName: string } | null };
  if (!response.ok || !result.data) return errorResponse(result.message || "账号或密码错误", 401);
  const user = result.data;
  return createLoginResponse(user);
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ code: status, message, data: null }, { status });
}
