"use client";

import { useEffect } from "react";
import { Toast } from "@heroui/react";
import { ApiRequestError } from "@lib/api-request";
import { notify, notifySystemError } from "@lib/notify";
import { SYSTEM_FAILURE_EVENT, type SystemFailureKind, wasSystemErrorRecentlyReported } from "@lib/system-notification";

export function AppToastProvider() {
  useEffect(() => {
    const report = (reason: unknown) => {
      if (wasSystemErrorRecentlyReported()) return;
      if (reason instanceof ApiRequestError && reason.kind !== "business") return;
      notify.error("页面发生异常", { dedupeKey: "unhandled-runtime-error" });
    };
    const onError = (event: ErrorEvent) => report(event.error);
    const onRejection = (event: PromiseRejectionEvent) => report(event.reason);
    const onSystemFailure = (event: Event) => notifySystemError((event as CustomEvent<SystemFailureKind>).detail);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener(SYSTEM_FAILURE_EVENT, onSystemFailure);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener(SYSTEM_FAILURE_EVENT, onSystemFailure);
    };
  }, []);
  return <Toast.Provider placement="bottom end" maxVisibleToasts={5} />;
}
