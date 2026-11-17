import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releasePlatform } from './package-platform.mjs';

const imageId = 'sha256:' + 'b'.repeat(64);
const tar = Buffer.from('offline-image-test-payload');

test('release verifies and exports full image ZIP without pushing or logging into a registry', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'yaya-platform-release-'));
  const output = path.join(root, 'releases');
  await mkdir(path.join(root,'deploy'));
  await writeFile(path.join(root,'deploy','platform-runtime.json'),JSON.stringify({webPort:8787,apiPort:8788,volumes:[{key:'database',destination:'/var/lib/postgresql'},{key:'platform-state',destination:'/var/lib/yaya'}],environment:[]}));
  await writeFile(path.join(root, 'CHANGELOG.md'), '# Changelog\n## 99.8 - date\n');
  const calls = [];
  const stages = [];
  try {
    const result = await releasePlatform({
      root, output,
      expectedVersion: '99.8',
      onProgress: async stage => stages.push(stage),
      run: async (args) => {
        calls.push(args);
        if (args[0] === 'image' && args[1] === 'inspect') return JSON.stringify({Id:imageId, Os:'linux', Architecture:'amd64', Config:{Env:['PATH=/usr/bin:/bin','VERSION_SPECIFIC=value=a=b']}});
        if (args[0] === 'image' && args[1] === 'save') await writeFile(args[3], tar);
        return '';
      },
      verify: async (image) => { assert.match(image, /^yaya-platform:99\.8-/); calls.push(['verify']); },
    });
    assert.deepEqual(calls.map((args) => args[0]), ['buildx', 'verify', 'image', 'image']);
    assert.deepEqual(stages, ['build', 'verify', 'export', 'hash', 'archive']);
    assert.equal(calls.some((args) => ['push','pull','login'].includes(args[0])), false);
    const archive = await JSZip.loadAsync(await readFile(result.path), { checkCRC32: true });
    assert.deepEqual(Object.keys(archive.files).filter((name) => !archive.files[name].dir).sort(), ['image.tar','manifest.json']);
    const manifest = JSON.parse(await archive.file('manifest.json').async('string'));
    assert.equal(manifest.formatVersion, 3);
    assert.equal(manifest.artifactType, 'offline-image');
    assert.equal(manifest.image.id, imageId);
    assert.deepEqual(manifest.deployment.volumes, [{ key:'database', destination:'/var/lib/postgresql' },{key:'platform-state',destination:'/var/lib/yaya'}]);
    assert.equal(manifest.deployment.environment.find(e => e.name === 'VERSION_SPECIFIC').default, 'value=a=b');
    assert.equal(manifest.deployment.webPort, 8787);
    assert.equal(manifest.deployment.apiPort, 8788);
    assert.deepEqual(manifest.image.environment, ['PATH=/usr/bin:/bin','VERSION_SPECIFIC=value=a=b']);
    assert.equal(manifest.image.tag, 'yaya-platform:99.8-' + manifest.packageId);
    assert.equal(manifest.image.archive, 'image.tar');
    assert.equal(manifest.image.size, tar.length);
    const payload = await archive.file('image.tar').async('nodebuffer');
    assert.deepEqual(payload, tar);
    assert.equal(manifest.image.sha256, createHash('sha256').update(payload).digest('hex'));
    assert.equal(manifest.files, undefined);
    assert.equal(manifest.build, undefined);
    assert.equal(result.filename, '99.8-' + manifest.packageId + '.zip');
    assert.deepEqual(await readdir(output), [result.filename]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('confirmation rejects a changed version or runtime configuration before Docker runs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'yaya-platform-confirm-'));
  try {
    await writeFile(path.join(root, 'CHANGELOG.md'), '## 99.8 - date\n');
    await mkdir(path.join(root, 'deploy'));
    await writeFile(path.join(root, 'deploy', 'platform-runtime.json'), '{}');
    const run = async () => assert.fail('must not run Docker');
    await assert.rejects(releasePlatform({ root, run, expectedVersion: '99.7' }), /平台版本已变更/);
    await assert.rejects(releasePlatform({ root, run, expectedVersion: '99.8', expectedRuntimeHash: 'outdated' }), /部署配置已变更/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('detached worker records failure and releases its owned lock without publishing an artifact', async () => {
  const repository = fileURLToPath(new URL('../', import.meta.url));
  const jobs = path.join(repository, 'dist', 'releases', '.jobs');
  const lock = path.join(jobs, 'active');
  const id = (await import('node:crypto')).randomUUID();
  const folder = path.join(jobs, id);
  // Never interfere with an actual developer release.
  await mkdir(jobs, { recursive: true });
  try { await mkdir(lock); } catch { return; }
  try {
    await mkdir(folder);
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ id, pid: process.pid }));
    await writeFile(path.join(folder, 'status.json'), JSON.stringify({ id, version: '0.0-expected-stale', platform: 'linux/amd64', status: 'queued' }));
    const child = spawnSync(process.execPath, [path.join(repository, 'scripts', 'package-platform-worker.mjs'), id], { env: { ...process.env, NODE_ENV: 'development' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 1);
    const result = JSON.parse(await readFile(path.join(folder, 'status.json'), 'utf8'));
    assert.equal(result.status, 'failed');
    assert.match(result.error, /平台版本已变更/);
    assert.equal((await readdir(jobs)).includes('active'), false);
  } finally {
    await rm(folder, { recursive: true, force: true });
    const owner = JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8').catch(() => '{}'));
    if (owner.id === id) await rm(lock, { recursive: true, force: true });
  }
});

for (const flag of ['--source-only', '--image-repository']) test('removed flag fails before Docker: ' + flag, () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./package-platform.mjs', import.meta.url)), flag], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /用法:/);
});

test('failed image health check prevents export', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'yaya-platform-failed-'));
  const commands = [];
  try {
    await writeFile(path.join(root, 'CHANGELOG.md'), '## 99.8 - date\n');
    await assert.rejects(releasePlatform({
      root,
      run: async (args) => { commands.push(args[0]); },
      verify: async () => { throw new Error('health check failed'); },
    }), /health check failed/);
    assert.deepEqual(commands, ['buildx']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed export cleans temporary files and never publishes a ZIP', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'yaya-platform-export-failed-'));
  const output = path.join(root,'releases');
  try {
    await writeFile(path.join(root, 'CHANGELOG.md'), '## 99.8 - date\n');
    await assert.rejects(releasePlatform({root,output,verify:async()=>{},run:async(args)=>{
      if(args[1] === 'inspect') return JSON.stringify({Id:imageId,Os:'linux',Architecture:'amd64'});
      if(args[1] === 'save') { await writeFile(args[3], 'partial'); throw new Error('disk full'); }
      return '';
    }}), /disk full/);
    assert.deepEqual(await readdir(output),[]);
  } finally { await rm(root,{recursive:true,force:true}); }
});
