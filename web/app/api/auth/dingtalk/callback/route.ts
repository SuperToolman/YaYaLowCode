import { NextRequest, NextResponse } from "next/server";

import { setAuthCookie, signToken, TOKEN_TTL_SECONDS } from "../../_lib";
import { backendBaseUrl, getDingTalkSettings, safeRedirect } from "../../dingtalk-lib";

const OAUTH_STATE_COOKIE = "yaya-dingtalk-oauth-state";

type UserAccessTokenResponse = { accessToken?: string; expireIn?: number };
type DingTalkProfile = {
  unionId?: string;
  openId?: string;
  nick?: string;
  avatarUrl?: string;
  mobile?: string;
  email?: string;
};
type BackendEnvelope<T> = { code: number; message: string; data: T | null };
type LoginUser = { id: string; username: string; displayName: string };

export async function GET(request: NextRequest) {
  const stateData = readState(request.cookies.get(OAUTH_STATE_COOKIE)?.value);
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  if (!stateData || !state || state !== stateData.state || !code) {
    return failure(request, "钉钉登录请求已失效，请重新扫码");
  }

  try {
    const settings = await getDingTalkSettings();
    const tokenResponse = await fetch("https://api.dingtalk.com/v1.0/oauth2/userAccessToken", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: settings.clientId, clientSecret: settings.clientSecret, code, grantType: "authorization_code" }),
      cache: "no-store",
    });
    const token = (await tokenResponse.json()) as UserAccessTokenResponse;
    if (!tokenResponse.ok || !token.accessToken) throw new Error("钉钉未能确认本次授权");

    const profileResponse = await fetch("https://api.dingtalk.com/v1.0/contact/users/me", {
      headers: { "x-acs-dingtalk-access-token": token.accessToken },
      cache: "no-store",
    });
    const profile = (await profileResponse.json()) as DingTalkProfile;
    if (!profileResponse.ok || (!profile.unionId && !profile.openId)) throw new Error("未能获取钉钉用户身份");

    const userResponse = await fetch(`${backendBaseUrl}/api/identity/dingtalk/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile),
      cache: "no-store",
    });
    const userPayload = (await userResponse.json()) as BackendEnvelope<LoginUser>;
    if (!userResponse.ok || userPayload.code !== 0 || !userPayload.data) {
      throw new Error(userPayload.message || "该钉钉账号尚未授权登录");
    }

    const now = Math.floor(Date.now() / 1000);
    const user = userPayload.data;
    const tokenValue = signToken(
      { sub: user.id, name: user.displayName, username: user.username, iat: now, exp: now + TOKEN_TTL_SECONDS },
      process.env.AUTH_TOKEN_SECRET ?? "yaya-development-token-secret",
    );
    const completionUrl = new URL("/login", request.url);
    completionUrl.searchParams.set("dingtalkComplete", "1");
    completionUrl.searchParams.set("redirect", safeRedirect(stateData.redirect));
    const response = NextResponse.redirect(completionUrl);
    setAuthCookie(response, tokenValue);
    clearOAuthState(response);
    return response;
  } catch (error) {
    return failure(request, error instanceof Error ? error.message : "钉钉登录失败");
  }
}

function readState(value: string | undefined): { state: string; redirect: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { state?: string; redirect?: string };
    return typeof parsed.state === "string" && typeof parsed.redirect === "string" ? { state: parsed.state, redirect: parsed.redirect } : null;
  } catch {
    return null;
  }
}

function failure(request: NextRequest, message: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("dingtalkError", message);
  const response = NextResponse.redirect(url);
  clearOAuthState(response);
  return response;
}

function clearOAuthState(response: NextResponse) {
  response.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/api/auth/dingtalk", maxAge: 0 });
}
