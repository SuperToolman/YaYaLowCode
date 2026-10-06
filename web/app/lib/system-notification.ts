export type SystemFailureKind = "network" | "timeout" | "server" | "auth" | "invalid-response";

export const SYSTEM_FAILURE_EVENT = "yaya-system-failure";
let lastReportedAt = 0;

export function reportSystemFailure(kind: SystemFailureKind) {
  if (typeof window === "undefined") return;
  lastReportedAt = Date.now();
  window.dispatchEvent(new CustomEvent<SystemFailureKind>(SYSTEM_FAILURE_EVENT, { detail: kind }));
}

export function wasSystemErrorRecentlyReported() {
  return Date.now() - lastReportedAt < 1_000;
}
