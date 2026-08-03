import { NextResponse } from "next/server";
import { shouldUseSecureCookie } from "../_lib";

export async function POST() {
  const response = NextResponse.json({ code: 0, message: "已退出登录", data: null });
  response.cookies.set("yaya-auth-token", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    path: "/",
    maxAge: 0,
  });
  return response;
}
