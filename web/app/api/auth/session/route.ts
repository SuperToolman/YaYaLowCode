import { NextRequest, NextResponse } from "next/server";

type TokenPayload = { sub?: string; name?: string; username?: string; exp?: number };

export function GET(request: NextRequest) {
  const token = request.cookies.get("yaya-auth-token")?.value;
  const payload = token ? readPayload(token) : null;
  if (!token || !payload || typeof payload.sub !== "string" || typeof payload.name !== "string" || typeof payload.username !== "string") {
    return NextResponse.json({ code: 401, message: "未登录", data: null }, { status: 401 });
  }
  return NextResponse.json({
    code: 0,
    message: "登录会话已读取",
    data: { token, user: { id: payload.sub, displayName: payload.name, username: payload.username } },
  });
}

function readPayload(token: string): TokenPayload | null {
  try {
    const [, encodedPayload] = token.split(".");
    if (!encodedPayload) return null;
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as TokenPayload;
    return typeof payload.exp === "number" && payload.exp * 1000 > Date.now() ? payload : null;
  } catch {
    return null;
  }
}
