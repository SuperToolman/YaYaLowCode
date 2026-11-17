import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const TOKEN_TTL_SECONDS = 8 * 60 * 60;

export type { AuthUser } from "@/shared/lib/auth";
import type { AuthUser } from "@/shared/lib/auth";

export function createLoginResponse(user: AuthUser, operations?: { session: string; actor: string; expiresAt: number }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = operations ? Math.min(Math.floor(operations.expiresAt / 1000), now + 30 * 60) : now + TOKEN_TTL_SECONDS;
  const token = signToken(
    { sub: user.id, name: user.displayName, username: user.username, iat: now, exp, jti: randomUUID(), ...(operations ? { operations_session: operations.session, operations_actor: operations.actor } : {}) },
    process.env.AUTH_TOKEN_SECRET ?? "yaya-development-token-secret",
  );
  const response = NextResponse.json({
    code: 0,
    message: "登录成功",
    data: { token, expiresAt: new Date(exp * 1000).toISOString(), user },
  });
  setAuthCookie(response, token);
  return response;
}

export function verifyAuthToken(token: string): Record<string, unknown> | null {
  try {
    const [header, body, signature, extra] = token.split(".");
    if (!header || !body || !signature || extra || JSON.parse(Buffer.from(header, "base64url").toString()).alg !== "HS256") return null;
    const expected = createHmac("sha256", process.env.AUTH_TOKEN_SECRET ?? "yaya-development-token-secret").update(`${header}.${body}`).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof payload.exp === "number" && payload.exp * 1000 > Date.now() ? payload : null;
  } catch { return null; }
}

export function setAuthCookie(response: NextResponse, token: string) {
  response.cookies.set("yaya-auth-token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
  });
}

export function shouldUseSecureCookie() {
  const configured = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV === "production";
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
