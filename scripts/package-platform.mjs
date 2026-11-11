import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, mkdtemp, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import archiver from 'archiver';
// Node 24 executes this exact parser used by /settings/about (no copied regex).
import { latestChangelogVersion } from '../web/features/settings/model/changelog.ts';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function docker(args, { capture = false } = {}) {
  const desktopCli = process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe') : '';
  const binary = process.env.DOCKER_CLI || (desktopCli && existsSync(desktopCli) ? desktopCli : 'docker');
  const env = path.isAbsolute(binary) ? { ...process.env, PATH: path.dirname(binary) + path.delimiter + (process.env.PATH || '') } : process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: repository, env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', windowsHide: true });
    let stdout = '';
    if (capture) child.stdout.setEncoding('utf8').on('data', chunk => { stdout = (stdout + chunk).slice(-65536); });
    child.once('error', error => reject(new Error(`无法启动 Docker CLI（${binary}）：${error.message}`)));
    child.once('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(`Docker ${args[0]} 失败，退出码 ${code}`)));
  });
}

function randomSecrets() {
  const env = {
    POSTGRES_PASSWORD: randomUUID() + randomUUID(),
    VALKEY_PASSWORD: randomUUID() + randomUUID(),
    AUTH_TOKEN_SECRET: randomUUID() + randomUUID(),
    BACKEND_INTERNAL_TOKEN: randomUUID() + randomUUID(),
    YAYA_AGENT_V2_WORKER_SECRET: randomUUID() + randomUUID(),
    YAYA_BYOM_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    AUTH_COOKIE_SECURE: 'false',
    YAYA_LICENSE_PUBLIC_KEY_PATH: '/tmp/yaya-release-license-public.pem',
    APP_ENV: 'production',
    APP_HOST: '0.0.0.0',
    APP_PORT: '8788',
    POSTGRES_DB: 'yaya_low_code',
    POSTGRES_USER: 'yaya',
    BACKEND_API_BASE_URL: 'http://127.0.0.1:8788',
    YAYA_AGENT_V2_API_URL: 'http://127.0.0.1:8788',
    YAYA_AGENT_V2_CORDIS_HOST: '/app/agent-v2/cordis-host/src/host.mjs',
    YAYA_AGENT_V2_OFFICE_PATH: '/usr/local/bin/yaya-agent-v2-office',
    YAYA_AGENT_V2_EXECUTION_URL: 'http://127.0.0.1:8791',
    YAYA_EXECUTION_ROOT: '/var/lib/yaya/executions',
  };
  env.DATABASE_URL = `postgres://${env.POSTGRES_USER}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:5432/${env.POSTGRES_DB}`;
  env.VALKEY_URL = `redis://:${encodeURIComponent(env.VALKEY_PASSWORD)}@127.0.0.1:6379/0`;
  env.YAYA_EXECUTION_SECRET = env.YAYA_AGENT_V2_WORKER_SECRET;
  return env;
}

async function smokeTest(image, run = docker) {
  const root = await mkdtemp(path.join(process.env.TEMP || process.env.TMPDIR || '.', 'yaya-release-'));
  const name = `yaya-release-${randomUUID()}`;
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const env = randomSecrets();
  const envFile = path.join(root, 'smoke.env');
  let created = false;
  try {
    await writeFile(path.join(root, 'license-public.pem'), publicKey, { mode: 0o600 });
    await writeFile(envFile, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'), { mode: 0o600 });
    await run(['create', '--name', name, '--publish', '127.0.0.1::8787', '--publish', '127.0.0.1::8788', '--env-file', envFile, image]);
    created = true;
    await run(['cp', path.join(root, 'license-public.pem'), `${name}:/tmp/yaya-release-license-public.pem`]);
    await run(['start', name]);
    const apiPort = Number((await run(['port', name, '8788/tcp'], { capture: true })).split(':').at(-1));
    const webPort = Number((await run(['port', name, '8787/tcp'], { capture: true })).split(':').at(-1));
    if (!apiPort || !webPort) throw new Error('读取临时容器健康检查端口失败');
    const deadline = Date.now() + 180_000;
    let lastError = '应用仍在启动';
    while (Date.now() < deadline) {
      try {
        const api = await fetch(`http://127.0.0.1:${apiPort}/healthz`, { signal: AbortSignal.timeout(3000) });
        const web = await fetch(`http://127.0.0.1:${webPort}/login`, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
        if (api.ok && web.status >= 200 && web.status < 400) return;
        lastError = `API HTTP ${api.status}，Web HTTP ${web.status}`;
      } catch (error) { lastError = error.message; }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    const logs = await run(['logs', '--tail', '80', name], { capture: true }).catch(() => '');
    throw new Error(`镜像健康检查超时：${lastError}${logs ? `\n${logs.slice(-12000)}` : ''}`);
  } catch (error) {
    const logs = created ? await run(['logs', '--tail', '80', name], { capture: true }).catch(() => '') : '';
    throw new Error(`${error.message}${logs ? `\n容器启动日志：\n${logs.slice(-12000)}` : ''}`, { cause: error });
  } finally {
    if (created) await run(['rm', '--force', name]).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}

async function deploymentManifest(root, imageEnvironment) {
  const runtime = JSON.parse(await readFile(path.join(root, 'deploy', 'platform-runtime.json'), 'utf8'));
  if (!Array.isArray(runtime.volumes) || !Array.isArray(runtime.environment) || !runtime.webPort || !runtime.apiPort) throw new Error('deploy/platform-runtime.json 部署清单不完整');
  const variables = new Map(imageEnvironment.map(entry => {
    const i = entry.indexOf('='); return [entry.slice(0, i), { name: entry.slice(0, i), default: entry.slice(i + 1), required: false }];
  }));
  for (const item of runtime.environment) variables.set(item.name, { ...variables.get(item.name), ...item });
  return { ...runtime, environment: [...variables.values()] };
}

export async function releasePlatform({ root = repository, output = path.join(root, 'dist', 'releases'), platform = 'linux/amd64', run = docker, verify = smokeTest } = {}) {
  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  const version = latestChangelogVersion(changelog);
  if (!version || !/^\d+(?:\.\d+)+(?:[a-zA-Z][\w.-]*|-[\w.-]+)?$/.test(version) || version.length > 64) throw new Error('CHANGELOG.md 缺少可用版本，无法发布');
  if (!['linux/amd64', 'linux/arm64'].includes(platform)) throw new Error('仅支持 linux/amd64 或 linux/arm64');
  const packageId = randomUUID();
  const imageTag = `yaya-platform:${version}-${packageId}`;
  await run(['buildx', 'build', '--load', '--platform', platform, '--build-arg', `CARGO_REGISTRIES_CRATES_IO_INDEX=${process.env.CARGO_REGISTRIES_CRATES_IO_INDEX || 'sparse+https://rsproxy.cn/index/'}`, '--build-arg', `DEBIAN_MIRROR=${process.env.DEBIAN_MIRROR || 'http://mirrors.aliyun.com/debian'}`, '--build-arg', `DEBIAN_SECURITY_MIRROR=${process.env.DEBIAN_SECURITY_MIRROR || 'http://mirrors.aliyun.com/debian-security'}`, '--build-arg', `NEXT_PUBLIC_BACKEND_WS_URL=${process.env.NEXT_PUBLIC_BACKEND_WS_URL || ''}`, '--tag', imageTag, '--file', path.join(root, 'deploy', 'Dockerfile.single'), root]);
  await verify(imageTag, run);
  const inspected = JSON.parse(await run(['image', 'inspect', '--format', '{{json .}}', imageTag], { capture: true }));
  if (!/^sha256:[a-f0-9]{64}$/.test(inspected.Id) || `${inspected.Os}/${inspected.Architecture}` !== platform) throw new Error('构建镜像 ID 或架构不匹配');
  await mkdir(output, { recursive: true });
  const filename = `${version}-${packageId}.zip`;
  const target = path.join(output, filename);
  const temporary = `${target}.partial`;
  const exportRoot = await mkdtemp(path.join(output, '.image-export-'));
  const imageTar = path.join(exportRoot, 'image.tar');
  let archive, stream, closed;
  try {
    await run(['image', 'save', '--output', imageTar, imageTag]);
    const size = (await stat(imageTar)).size;
    if (size === 0 || size > 16 * 1024 ** 3) throw new Error('镜像归档为空或超过 16 GiB');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(imageTar)) hash.update(chunk);
    const manifest = {
      packageType: 'yaya-platform', formatVersion: 3, artifactType: 'offline-image',
      version, packageId, builtAt: new Date().toISOString(),
      deployment: await deploymentManifest(root, inspected.Config?.Env ?? []),
      image: { id: inspected.Id, tag: imageTag, platform, archive: 'image.tar', size, sha256: hash.digest('hex'), environment: inspected.Config?.Env ?? [] },
    };
    archive = archiver('zip', { zlib: { level: 6 }, forceZip64: true });
    stream = createWriteStream(temporary, { flags: 'wx' });
    closed = once(stream, 'close');
    closed.catch(() => {});
    archive.on('error', error => stream.destroy(error));
    archive.on('warning', error => stream.destroy(error));
    archive.pipe(stream);
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.file(imageTar, { name: 'image.tar', mode: 0o644 });
    await archive.finalize();
    await closed;
    if ((await stat(temporary)).size > 8 * 1024 ** 3) throw new Error('压缩包超过运营平台 8 GiB 上传限制');
    await rename(temporary, target);
    return { filename, path: target, version, packageId, imageId: inspected.Id, platform, size: (await stat(target)).size };
  } catch (error) {
    archive?.abort(); stream?.destroy();
    await closed?.catch(() => {});
    await rm(temporary, { force: true });
    throw error;
  } finally {
    await rm(exportRoot, { recursive: true, force: true });
  }

}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const flags = new Map();
    for (let index = 0; index < args.length;) {
      const flag = args[index++];
      if (!['--output', '--platform'].includes(flag) || flags.has(flag)) throw new Error('用法: node scripts/package-platform.mjs [--platform linux/amd64] [--output DIR]');
      {
        const value = args[index++];
        if (!value || value.startsWith('--')) throw new Error('用法: node scripts/package-platform.mjs [--platform linux/amd64] [--output DIR]');
        flags.set(flag, value);
      }
    }
    const result = await releasePlatform({ platform: flags.get('--platform') || process.env.YAYA_PLATFORM_IMAGE_PLATFORM || 'linux/amd64', output: flags.has('--output') ? path.resolve(flags.get('--output')) : undefined });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
