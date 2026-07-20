import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ code: 0, message: "已退出登录", data: null });
  response.cookies.set("yaya-auth-token", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
