"use client";

import { useEffect } from "react";
import { Toast } from "@heroui/react";
import { ApiRequestError, isRequestAborted, isSystemRequestError } from "@/shared/lib/api-request";
import { notify, notifySystemError } from "@/shared/lib/notify";
import { SYSTEM_FAILURE_EVENT, type SystemFailureKind } from "@/shared/lib/system-notification";

export function AppToastProvider() {
  useEffect(() => {
    const report = (reason: unknown) => {
      if (isRequestAborted(reason) || isSystemRequestError(reason) || (reason instanceof ApiRequestError && reason.status === 401)) return;
      notify.error("页面发生异常", { dedupeKey: "unhandled-runtime-error" });
    };
    const onError = (event: ErrorEvent) => {
      // Browser layout observers can report transient loop warnings while popovers reposition.
      if (/^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)\.?$/i.test(event.message.trim())) {
        return;
      }
      // Resource and browser layout events can reach window without a JS exception.
      if (event.error) report(event.error);
    };
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
  return <Toast.Provider placement="bottom" maxVisibleToasts={5} />;
}
