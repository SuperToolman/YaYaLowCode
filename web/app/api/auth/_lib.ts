import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export const TOKEN_TTL_SECONDS = 8 * 60 * 60;

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
};

export function createLoginResponse(user: AuthUser) {
  const now = Math.floor(Date.now() / 1000);
  const token = signToken(
    { sub: user.id, name: user.displayName, username: user.username, iat: now, exp: now + TOKEN_TTL_SECONDS, jti: randomUUID() },
    process.env.AUTH_TOKEN_SECRET ?? "yaya-development-token-secret",
  );
  const response = NextResponse.json({
    code: 0,
    message: "登录成功",
    data: { token, expiresAt: new Date((now + TOKEN_TTL_SECONDS) * 1000).toISOString(), user },
  });
  setAuthCookie(response, token);
  return response;
}

export function setAuthCookie(response: NextResponse, token: string) {
  response.cookies.set("yaya-auth-token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
  });
}

export function signToken(payload: Record<string, unknown>, secret: string) {
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}
