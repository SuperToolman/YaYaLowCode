import { jsonRequest, requestApi } from "@/shared/lib/api-request";
import type { PackagePlatform, PlatformPackageJob, PlatformPackageState } from "./model/platform-package";

// Local Next development tooling; intentionally absent from the Rust SDK.
export function getPlatformPackageState(signal?: AbortSignal) {
  return requestApi<PlatformPackageState>("/api/settings/platform-package", { signal, cache: "no-store", timeoutMs: 30_000 });
}
export function startPlatformPackage(version: string, platform: PackagePlatform, runtimeHash: string) {
  return requestApi<PlatformPackageJob & { logs: string }>("/api/settings/platform-package", {
    ...jsonRequest({ version, platform, runtimeHash }, { method: "POST" }), timeoutMs: 30_000,
  });
}
export function getPlatformPackageJob(id: string, signal?: AbortSignal) {
  return requestApi<PlatformPackageJob & { logs: string }>(`/api/settings/platform-package/${encodeURIComponent(id)}`, { signal, cache: "no-store" });
}
export function checkPlatformPackageDownload(id: string) {
  return requestApi<{ filename: string; size: number }>(`/api/settings/platform-package/${encodeURIComponent(id)}/download?check=true`, { cache: "no-store" });
}
