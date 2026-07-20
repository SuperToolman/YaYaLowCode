import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

type LoginRequest = {
  username?: string;
  password?: string;
};

const TOKEN_TTL_SECONDS = 8 * 60 * 60;

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

  const configuredUsername = process.env.AUTH_ADMIN_USERNAME;
  const configuredPassword = process.env.AUTH_ADMIN_PASSWORD;
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && (!configuredUsername || !configuredPassword || !process.env.AUTH_TOKEN_SECRET)) {
    return errorResponse("登录服务尚未完成生产环境配置", 503);
  }

  const expectedUsername = configuredUsername ?? "admin";
  const expectedPassword = configuredPassword ?? "admin123";
  if (!safeEqual(username, expectedUsername) || !safeEqual(password, expectedPassword)) {
    return errorResponse("账号或密码错误", 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "local-admin",
    username: expectedUsername,
    displayName: process.env.AUTH_ADMIN_DISPLAY_NAME ?? "平台管理员",
  };
  const token = signToken(
    { sub: user.id, name: user.displayName, username: user.username, iat: now, exp: now + TOKEN_TTL_SECONDS, jti: randomUUID() },
    process.env.AUTH_TOKEN_SECRET ?? "yaya-development-token-secret",
  );

  const response = NextResponse.json({
    code: 0,
    message: "登录成功",
    data: { token, expiresAt: new Date((now + TOKEN_TTL_SECONDS) * 1000).toISOString(), user },
  });
  response.cookies.set("yaya-auth-token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
  });
  return response;
}

function signToken(payload: Record<string, unknown>, secret: string) {
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ code: status, message, data: null }, { status });
}
