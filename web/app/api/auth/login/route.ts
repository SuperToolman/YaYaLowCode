import { NextResponse } from "next/server";
import { createLoginResponse } from "../_lib";
import { localLogin } from "@lib/http";
import { createBackendSdkClient } from "@lib/backend-client";

import type { LoginRequest } from "@features/auth/contracts";

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

  const result = await localLogin({ client: createBackendSdkClient(request), body: { username, password } });
  if (result.error || !result.data?.data || result.data.code !== 0) {
    const detail = result.error && typeof result.error === "object" && "message" in result.error ? String(result.error.message) : result.data?.message;
    return errorResponse(detail || "账号或密码错误", result.response?.status ?? 503);
  }
  const user = result.data.data;
  return createLoginResponse(user);
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ code: status, message, data: null }, { status });
}
