import { ApiRequestError, isRequestAborted, isSystemRequestError } from "./api-request";
import { toast } from "@heroui/react";

type ToastOptions = NonNullable<Parameters<typeof toast.success>[1]>;
type NotifyOptions = ToastOptions & { dedupeKey?: string };
type Level = "success" | "error" | "warning" | "info";

const recent = new Map<string, number>();
const DEDUPE_MS = 2_000;
const SYSTEM_DEDUPE_MS = 30_000;

function show(level: Level, title: string, options: NotifyOptions = {}) {
  if (typeof window === "undefined") return;
  const { dedupeKey, ...toastOptions } = options;
  toastOptions.timeout ??= level === "error" ? 7_000 : 5_000;
  const now = Date.now();
  const key = dedupeKey ?? `${level}:${title}:${String(options.description ?? "")}`;
  const dedupeMs = key.startsWith("system:") ? SYSTEM_DEDUPE_MS : DEDUPE_MS;
  if (now - (recent.get(key) ?? 0) < dedupeMs) return;
  if (recent.size > 100) {
    for (const [entry, time] of recent) if (now - time > SYSTEM_DEDUPE_MS) recent.delete(entry);
  }
  recent.set(key, now);
  if (level === "error") toast.danger(title, toastOptions);
  else toast[level](title, toastOptions);
}

export const notify = {
  success: (title: string, options?: NotifyOptions) => show("success", title, options),
  error: (title: string, options?: NotifyOptions) => show("error", title, options),
  warning: (title: string, options?: NotifyOptions) => show("warning", title, options),
  info: (title: string, options?: NotifyOptions) => show("info", title, options),
};

export function notifySystemError(kind: "network" | "timeout" | "server" | "auth" | "invalid-response", detail?: string) {
  const titles = {
    network: "网络连接失败",
    timeout: "请求超时",
    server: "服务暂时不可用",
    auth: "登录状态已失效",
    "invalid-response": "服务响应异常",
  };
  notify.error(titles[kind], { description: detail, dedupeKey: `system:${kind}` });
}

/** Page business context is shown only when the public layer has no system toast. */
export function notifyRequestError(error: unknown, title: string, options?: NotifyOptions) {
  if (isRequestAborted(error) || isSystemRequestError(error) || (error instanceof ApiRequestError && error.status === 401)) return;
  notify.error(title, options);
}
