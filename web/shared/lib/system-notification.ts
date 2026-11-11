export type SystemFailureKind = "network" | "timeout" | "server" | "auth" | "invalid-response";

export const SYSTEM_FAILURE_EVENT = "yaya-system-failure";

export function reportSystemFailure(kind: SystemFailureKind) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SystemFailureKind>(SYSTEM_FAILURE_EVENT, { detail: kind }));
}

