import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "../_lib";


export function GET(request: NextRequest) {
  const token = request.cookies.get("yaya-auth-token")?.value;
  const payload = token ? verifyAuthToken(token) : null;
  if (!token || !payload || typeof payload.sub !== "string" || typeof payload.name !== "string" || typeof payload.username !== "string") {
    return NextResponse.json({ code: 401, message: "未登录", data: null }, { status: 401 });
  }
  return NextResponse.json({
    code: 0,
    message: "登录会话已读取",
    data: { token, user: { id: payload.sub, displayName: payload.name, username: payload.username } },
  });
}

