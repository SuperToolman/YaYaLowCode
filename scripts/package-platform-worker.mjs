// Detached development-only worker: a Next HMR reload must not interrupt a release.
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jobs = path.join(root, 'dist', 'releases', '.jobs');

async function main() {
  if (process.env.NODE_ENV !== 'development') throw new Error('离线打包仅在开发环境开放');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('离线打包需要 Node.js 24 或更高版本');
  if (process.argv[2] === '--check') {
    const { docker } = await import('./package-platform.mjs');
    const os = await docker(['info', '--format', '{{.OSType}}'], { capture: true, timeout: 10000 });
    if (os !== 'linux') throw new Error('请启动 Docker，并切换到 Linux 容器环境');
    await docker(['buildx', 'version'], { capture: true, timeout: 10000 });
    console.log(JSON.stringify({ ready: true }));
    return;
  }
  const id = process.argv[2];
  if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('无效的打包任务');
  const folder = path.join(jobs, id);
  const statusFile = path.join(folder, 'status.json');
  let job = JSON.parse(await readFile(statusFile, 'utf8'));
  const save = async (changes) => {
    job = { ...job, ...changes };
    const temp = statusFile + '.tmp';
    await writeFile(temp, JSON.stringify(job), { mode: 0o600 });
    await rename(temp, statusFile);
  };
  try {
    const ownerFile = path.join(jobs, 'active', 'owner.json');
    const owner = JSON.parse(await readFile(ownerFile, 'utf8'));
    if (owner.id !== id) throw new Error('任务不再持有打包锁');
    const ownerTemporary = ownerFile + '.' + process.pid + '.tmp';
    await writeFile(ownerTemporary, JSON.stringify({ id, pid: process.pid }), { mode: 0o600 });
    await rename(ownerTemporary, ownerFile);
    await save({ status: 'running', pid: process.pid, startedAt: new Date().toISOString() });
    const { releasePlatform } = await import('./package-platform.mjs');
    const result = await releasePlatform({
      platform: job.platform,
      expectedVersion: job.version,
      expectedRuntimeHash: job.runtimeHash,
      onProgress: async (stage, message) => {
        console.log(`[${new Date().toISOString()}] ${message}`);
        await save({ stage, message });
      },
    });
    await save({ status: 'succeeded', stage: 'done', message: '离线包已生成', result, finishedAt: new Date().toISOString() });
  } catch (error) {
    console.error(error.stack || error.message);
    await save({ status: 'failed', message: '离线打包失败', error: error.message.slice(-16000), finishedAt: new Date().toISOString() });
    process.exitCode = 1;
  } finally {
    const lock = path.join(jobs, 'active');
    const owner = JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8').catch(() => '{}'));
    if (owner.id === id) await rm(lock, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
