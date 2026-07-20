import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getDingTalkSettings, safeRedirect } from "../dingtalk-lib";

const OAUTH_STATE_COOKIE = "yaya-dingtalk-oauth-state";

export async function GET(request: NextRequest) {
  try {
    const settings = await getDingTalkSettings();
    if (!settings.clientId || !settings.clientSecret) {
      return redirectToLogin(request, "钉钉 Client ID 或 Client Secret 尚未配置");
    }

    const state = randomBytes(32).toString("base64url");
    const redirect = safeRedirect(request.nextUrl.searchParams.get("redirect"));
    const callbackUrl = new URL("/api/auth/dingtalk/callback", request.url).toString();
    const authorizationUrl = new URL("https://login.dingtalk.com/oauth2/auth");
    authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", settings.clientId);
    authorizationUrl.searchParams.set("scope", "openid");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("prompt", "consent");

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(OAUTH_STATE_COOKIE, JSON.stringify({ state, redirect }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth/dingtalk",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    return redirectToLogin(request, error instanceof Error ? error.message : "无法启动钉钉登录");
  }
}

function redirectToLogin(request: NextRequest, error: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("dingtalkError", error);
  return NextResponse.redirect(url);
}
