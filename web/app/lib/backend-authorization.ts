export function backendAuthorizationHeaders(
  request: Request,
): Record<string, string> {
  const direct = request.headers.get("authorization")?.trim();
  if (direct?.toLowerCase().startsWith("bearer ")) return { authorization: direct };
  const token = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)yaya-auth-token=([^;]+)/)?.[1];
  return token ? { authorization: `Bearer ${token}` } : {};
}

