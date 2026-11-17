// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { authorizePackaging, readPackageInput, readPackageJob, downloadPackage } from "./platform-packages";

const mocks = vi.hoisted(() => ({ grants: vi.fn() }));
vi.mock("@/shared/lib/http", () => ({ getAuthorizationGrants: mocks.grants }));
vi.mock("@/shared/lib/backend-client", () => ({ createBackendSdkClient: vi.fn() }));

const folders: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs(); vi.clearAllMocks();
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});
const request = (options?: RequestInit) => new Request("http://localhost:3000/api/settings/platform-package", options);

it("denies production, missing auth, non-admin roles and cross-origin starts", async () => {
  vi.stubEnv("NODE_ENV", "production");
  await expect(authorizePackaging(request())).rejects.toMatchObject({ status: 404 });
  expect(mocks.grants).not.toHaveBeenCalled();
  vi.stubEnv("NODE_ENV", "development");
  await expect(authorizePackaging(request())).rejects.toMatchObject({ status: 401 });
  mocks.grants.mockResolvedValue({ data: { code: 0, message: "ok", data: ["settings.license.manage"] } });
  await expect(authorizePackaging(request({ headers: { authorization: "Bearer test" } }))).rejects.toMatchObject({ status: 403 });
  mocks.grants.mockResolvedValue({ data: { code: 0, message: "ok", data: ["*"] } });
  await expect(authorizePackaging(request({ method: "POST", headers: { authorization: "Bearer test", origin: "http://other.test" } }))).rejects.toMatchObject({ status: 403 });
  await expect(authorizePackaging(request({ method: "POST", headers: { authorization: "Bearer test", origin: "http://localhost:3000" } }))).resolves.toBeUndefined();
});

it("rejects oversized or malformed confirmation bodies", async () => {
  await expect(readPackageInput(request({ method: "POST", body: "x".repeat(4097) }))).rejects.toMatchObject({ status: 413 });
  await expect(readPackageInput(request({ method: "POST", body: "{" }))).rejects.toMatchObject({ status: 400 });
  await expect(readPackageInput(request({ method: "POST", body: '{"platform":"linux/amd64"}' }))).resolves.toEqual({ platform: "linux/amd64" });
});

it("uses the actual Host when Next normalizes the URL to localhost, and rejects other origins", async () => {
  vi.stubEnv("NODE_ENV", "development");
  mocks.grants.mockResolvedValue({ data: { code: 0, message: "ok", data: ["*"] } });
  const nextRequest = (host: string, origin?: string, extra?: Record<string, string>) => new Request("http://localhost:8787/api/settings/platform-package", {
    method: "POST", headers: { host, authorization: "Bearer test", ...(origin ? { origin } : {}), ...extra },
  });
  await expect(authorizePackaging(nextRequest("127.0.0.1:8787", "http://127.0.0.1:8787"))).resolves.toBeUndefined();
  await expect(authorizePackaging(nextRequest("192.168.1.10:8787", "http://192.168.1.10:8787"))).resolves.toBeUndefined();
  await expect(authorizePackaging(nextRequest("localhost:8787", "http://localhost:8787"))).resolves.toBeUndefined();
  for (const origin of ["http://other.test", "http://127.0.0.1:3000", "http://localhost:8787", "null", undefined]) {
    await expect(authorizePackaging(nextRequest("127.0.0.1:8787", origin))).rejects.toMatchObject({ status: 403 });
  }
  await expect(authorizePackaging(nextRequest("127.0.0.1:8787", "http://127.0.0.1:8787", { "sec-fetch-site": "cross-site" }))).rejects.toMatchObject({ status: 403 });
  await expect(authorizePackaging(nextRequest("other.test@127.0.0.1:8787", "http://127.0.0.1:8787"))).rejects.toMatchObject({ status: 403 });
  await expect(authorizePackaging(nextRequest("127.0.0.1:8787", "http://other.test", { "x-forwarded-host": "other.test" }))).rejects.toMatchObject({ status: 403 });
});

it("recovers an interrupted job and does not offer a partial package for download", async () => {
  const id = randomUUID();
  const folder = path.resolve(process.cwd(), "../dist/releases/.jobs", id);
  folders.push(folder);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "status.json"), JSON.stringify({ id, status: "running", createdAt: new Date(Date.now() - 60000).toISOString(), stage: "export", version: "1.0", platform: "linux/amd64" }));
  await writeFile(path.join(folder, "build.log"), "export interrupted\n");
  expect(await readPackageJob(id)).toMatchObject({ status: "failed", logs: "export interrupted\n" });
  await expect(downloadPackage(id)).rejects.toMatchObject({ status: 409 });
  await expect(readPackageJob("../../outside")).rejects.toMatchObject({ status: 400 });
});
