import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createReadStream, openSync, closeSync } from "node:fs";
import { mkdir, readFile, writeFile, rename, rm, stat, open } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { getAuthorizationGrants } from "@/shared/lib/http";
import { createBackendSdkClient } from "@/shared/lib/backend-client";
import { ApiRequestError, unwrapApiResult } from "@/shared/lib/api-request";
import { backendAuthorizationHeaders } from "@/shared/lib/backend-authorization";
import { loadPlatformChangelog } from "./changelog";
import type { PlatformPackageDeployment, PlatformPackageJob, PlatformPackageState, PackagePlatform } from "../model/platform-package";

const execute = promisify(execFile);
const root = path.resolve(process.cwd(), "..");
const output = path.join(root, "dist", "releases");
const jobs = path.join(output, ".jobs");
const lock = path.join(jobs, "active");
const worker = path.join(root, "scripts", "package-platform-worker.mjs");
const validId = (value: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

export class PackageError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export async function authorizePackaging(request: Request) {
  if (process.env.NODE_ENV !== "development") throw new PackageError("未找到此功能", 404);
  if (request.method !== "GET" && !isSamePackagingOrigin(request)) {
    throw new PackageError("请求来源与当前开发平台地址不一致，请刷新页面后重试", 403);
  }
  if (!backendAuthorizationHeaders(request).authorization) throw new PackageError("请先登录", 401);
  // Let Rust validate the signed token, current account status and live role bindings.
  const grants = unwrapApiResult(await getAuthorizationGrants({ client: createBackendSdkClient(request) }));
  if (!grants.includes("*")) throw new PackageError("仅系统管理员可以打包平台", 403);
}

function isSamePackagingOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  try {
    const url = new URL(request.url);
    // Next dev normalizes request.url to localhost even when the browser uses
    // 127.0.0.1 or a LAN IP. Host retains the actual authority and port.
    const host = request.headers.get("host") ?? url.host;
    if (!host || /[\s,/@?#\\]/.test(host)) return false;
    const expected = new URL(`${url.protocol}//${host}`);
    return (expected.protocol === "http:" || expected.protocol === "https:") && origin === expected.origin;
  } catch { return false; }
}

export function packageResponse(data: unknown) {
  return NextResponse.json({ code: 0, message: "ok", data }, { headers: { "cache-control": "private, no-store" } });
}

export function packageFailure(error: unknown) {
  const status = error instanceof PackageError ? error.status : error instanceof ApiRequestError && error.status ? error.status : 500;
  return NextResponse.json({ code: status, message: error instanceof Error ? error.message : "打包服务异常", data: null }, { status, headers: { "cache-control": "no-store" } });
}

export async function readPackageInput(request: Request) {
  if (Number(request.headers.get("content-length")) > 4096) throw new PackageError("包信息超过限制", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new PackageError("请确认包信息");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new PackageError("包信息超过限制", 413); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new PackageError("包信息不是有效的 JSON"); }
}

async function jsonFile<T>(filename: string): Promise<T | null> {
  try { return JSON.parse(await readFile(filename, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function save(filename: string, data: unknown) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
  await rename(temporary, filename);
}

function alive(pid?: number) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

async function tail(filename: string) {
  const file = await open(filename, "r").catch(() => null);
  if (!file) return "";
  try {
    const size = (await file.stat()).size;
    const buffer = Buffer.alloc(Math.min(size, 64 * 1024));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
    return buffer.subarray(0, bytesRead).toString("utf8").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  } finally { await file.close(); }
}

export async function readPackageJob(id: string) {
  if (!validId(id)) throw new PackageError("无效的任务编号");
  const folder = path.join(jobs, id);
  let job = await jsonFile<PlatformPackageJob>(path.join(folder, "status.json"));
  if (!job) throw new PackageError("打包任务不存在", 404);
  if ((job.status === "running" || job.status === "queued") && Date.now() - Date.parse(job.createdAt) > 30_000 && !alive(job.pid)) {
    job = { ...job, status: "failed", message: "离线打包已中断", error: "打包进程已退出，请查看日志后重新打包", finishedAt: new Date().toISOString() };
    await save(path.join(folder, "status.json"), job);
  }
  return { ...job, logs: await tail(path.join(folder, "build.log")) };
}

async function latestJob() {
  const current = await jsonFile<{ id: string }>(path.join(jobs, "latest.json"));
  return current ? readPackageJob(current.id) : null;
}

async function prerequisites() {
  try {
    await execute(process.execPath, [worker, "--check"], { cwd: root, timeout: 25_000, maxBuffer: 64 * 1024, windowsHide: true });
    return { ready: true };
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    return { ready: false, reason: `打包环境未就绪：${(failure.stderr?.trim() || failure.message).slice(-4000)}` };
  }
}

export async function packageState(): Promise<PlatformPackageState> {
  const [{ version }, job] = await Promise.all([loadPlatformChangelog(), latestJob()]);
  const environment = await prerequisites();
  return { version, outputDirectory: output, ...await runtimeConfiguration(), ...environment, job };
}

async function runtimeConfiguration() {
  const source = await readFile(path.join(root, "deploy", "platform-runtime.json"), "utf8");
  const deployment = JSON.parse(source) as PlatformPackageDeployment;
  if (!Array.isArray(deployment.environment) || !Array.isArray(deployment.volumes) || !deployment.webPort || !deployment.apiPort) {
    throw new PackageError("部署清单不完整，请检查 deploy/platform-runtime.json", 422);
  }
  return { deployment, runtimeHash: createHash("sha256").update(source).digest("hex") };
}

// Share the critical section across Next HMR module instances in this process.
const scheduler = globalThis as typeof globalThis & { yayaPackageStart?: Promise<void> };
export async function startPackageJob(body: unknown) {
  const previous = scheduler.yayaPackageStart ?? Promise.resolve();
  let release!: () => void;
  scheduler.yayaPackageStart = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await startPackageJobExclusive(body); }
  finally { release(); }
}

async function startPackageJobExclusive(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new PackageError("无效的包信息");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !["version", "platform", "runtimeHash"].includes(key))) throw new PackageError("包信息包含未知字段");
  if (!["linux/amd64", "linux/arm64"].includes(String(input.platform))) throw new PackageError("请选择有效的 Linux 架构");
  const { version } = await loadPlatformChangelog();
  if (!version || input.version !== version) throw new PackageError("平台版本已变更，请重新打开弹窗确认", 409);
  const { runtimeHash } = await runtimeConfiguration();
  if (input.runtimeHash !== runtimeHash) throw new PackageError("部署配置已变更，请重新检查环境变量与数据卷", 409);
  const environment = await prerequisites();
  if (!environment.ready) throw new PackageError(environment.reason || "打包环境未就绪", 422);
  await mkdir(jobs, { recursive: true });
  try { await mkdir(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = await jsonFile<{ id: string; pid: number }>(path.join(lock, "owner.json"));
    const age = Date.now() - (await stat(lock)).mtimeMs;
    if (owner ? alive(owner.pid) : age < 30_000) throw new PackageError("已有打包任务正在执行，请等待完成", 409);
    await rm(lock, { recursive: true });
    try { await mkdir(lock); } catch { throw new PackageError("已有打包任务正在启动", 409); }
  }
  const id = randomUUID();
  const folder = path.join(jobs, id);
  const job: PlatformPackageJob = { id, version, runtimeHash, platform: input.platform as PackagePlatform, status: "queued", stage: "queued", message: "正在启动打包任务", createdAt: new Date().toISOString() };
  try {
    await mkdir(folder);
    await save(path.join(folder, "status.json"), job);
    await save(path.join(lock, "owner.json"), { id, pid: process.pid });
    await save(path.join(jobs, "latest.json"), { id });
    const log = openSync(path.join(folder, "build.log"), "a", 0o600);
    try {
      const child = spawn(process.execPath, [worker, id], { cwd: root, detached: true, windowsHide: true, stdio: ["ignore", log, log] });
      await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      child.unref();
    } finally { closeSync(log); }
    return readPackageJob(id);
  } catch (error) {
    await save(path.join(folder, "status.json"), { ...job, status: "failed", error: error instanceof Error ? error.message : "无法启动打包进程", message: "打包启动失败", finishedAt: new Date().toISOString() }).catch(() => {});
    await rm(lock, { recursive: true, force: true });
    throw error;
  }
}

export async function downloadPackage(id: string, check = false) {
  const job = await readPackageJob(id);
  if (job.status !== "succeeded" || !job.result) throw new PackageError("打包尚未完成", 409);
  const filename = job.result.filename;
  if (path.basename(filename) !== filename || !filename.endsWith(".zip")) throw new PackageError("无效的包文件");
  const file = path.join(output, filename);
  const metadata = await stat(file).catch(() => null);
  if (!metadata?.isFile()) throw new PackageError("离线包已被移动或删除", 404);
  if (check) return packageResponse({ filename, size: metadata.size });
  const stream = createReadStream(file);
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers: {
    "content-type": "application/zip", "content-length": String(metadata.size),
    "content-disposition": `attachment; filename="${filename}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff",
  } });
}
