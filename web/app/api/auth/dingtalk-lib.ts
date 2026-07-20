const backendBaseUrl = process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8787";

type BackendEnvelope<T> = { code: number; message: string; data: T | null };

export type DingTalkSettings = {
  clientId: string;
  clientSecret: string;
};

export async function getDingTalkSettings(): Promise<DingTalkSettings> {
  const internalToken =
    process.env.BACKEND_INTERNAL_TOKEN ??
    process.env.AUTH_TOKEN_SECRET ??
    "yaya-development-token-secret";
  const response = await fetch(`${backendBaseUrl}/api/internal/identity-source`, {
    cache: "no-store",
    headers: { "x-yaya-internal-token": internalToken },
  });
  const payload = (await response.json()) as BackendEnvelope<{
    dingtalk: { clientId: string; clientSecret: string };
  }>;
  if (!response.ok || payload.code !== 0 || !payload.data) {
    throw new Error(payload.message || "无法读取钉钉身份源配置");
  }
  return {
    clientId: payload.data.dingtalk.clientId.trim(),
    clientSecret: payload.data.dingtalk.clientSecret.trim(),
  };
}

export function safeRedirect(redirect: string | null) {
  return redirect && redirect.startsWith("/") && !redirect.startsWith("//") && !redirect.startsWith("/login") ? redirect : "/";
}

export { backendBaseUrl };
