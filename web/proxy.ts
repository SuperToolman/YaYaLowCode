import { NextResponse, type NextRequest } from "next/server";

const AUTH_COOKIE_NAME = "yaya-auth-token";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value ?? null;
  const authenticated = hasUsableToken(token);

  if (pathname === "/login") {
    if (!authenticated) return NextResponse.next();

    const redirect = request.nextUrl.searchParams.get("redirect");
    return NextResponse.redirect(new URL(getSafeRedirect(redirect), request.url));
  }

  if (authenticated) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

function hasUsableToken(token: string | null) {
  if (!token) return false;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

function getSafeRedirect(redirect: string | null) {
  return redirect && redirect.startsWith("/") && !redirect.startsWith("//") && !redirect.startsWith("/login") ? redirect : "/";
}
