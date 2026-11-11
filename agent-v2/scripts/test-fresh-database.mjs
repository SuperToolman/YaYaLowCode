// Explicit empty acceptance database only. Never dumps, drops or alters an existing platform DB.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../..', import.meta.url));
const resultDir = resolve(root, 'agent-v2/target/fresh-database');
mkdirSync(resultDir, { recursive: true });
let stage = 'preflight';
let fixture;
const children = [];
const handles = [];
const redactions = [];
const report = { status: 'blocked', stage, startedAt: new Date().toISOString(), migrations: [] };
const settings = Object.fromEntries((existsSync(join(root, 'deploy/.env')) ? readFileSync(join(root, 'deploy/.env'), 'utf8') : '').split(/\r?\n/)
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^["']|["']$/g, '')];
  }));
function sql(url, query) {
  const p = spawnSync(process.env.PSQL_PATH || 'E:/Soft/PostgreSQL/18/bin/psql.exe',
    ['-X', '-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', decodeURIComponent(url.pathname.slice(1)), '-At', '-v', 'ON_ERROR_STOP=1'],
    { input: query, encoding: 'utf8', env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGOPTIONS: '' } });
  if (p.status !== 0) throw new Error('Database check failed; connection details are deliberately omitted');
  return p.stdout.trim();
}
function launch(binary, args, env, label) {
  const out = openSync(join(resultDir, `${label}.log`), 'w');
  const err = openSync(join(resultDir, `${label}-error.log`), 'w');
  handles.push(out, err);
  const child = spawn(binary, args, { cwd: fixture, env, windowsHide: true, stdio: ['ignore', out, err] });
  children.push(child);
  child.on('error', () => {});
  return child;
}
async function exited(child) {
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('Migration timed out')), 120000);
    child.once('error', () => { clearTimeout(timer); fail(new Error('Acceptance binary unavailable')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? ok() : fail(new Error('Migration failed; inspect stage log')); });
  });
}
const delay = ms => new Promise(ok => setTimeout(ok, ms));
try {
  if (!process.env.AGENT_V2_FRESH_DATABASE_URL) throw new Error('Set explicit AGENT_V2_FRESH_DATABASE_URL to a dedicated empty database');
  const url = new URL(process.env.AGENT_V2_FRESH_DATABASE_URL);
  redactions.push(process.env.AGENT_V2_FRESH_DATABASE_URL, url.toString(), decodeURIComponent(url.password));
  for (const [key, value] of Object.entries({ ...settings, ...process.env })) {
    if (/SECRET|PASSWORD|ENCRYPTION_KEY|INTERNAL_TOKEN/.test(key) && value) redactions.push(value);
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || !/^agent_v2_acceptance_[a-z0-9_]+$/.test(name))
    throw new Error('Use an agent_v2_acceptance_* database without URL query parameters');
  const configuredNames = [settings.POSTGRES_DB];
  for (const value of [process.env.DATABASE_URL, process.env.AGENT_V2_TEST_DATABASE_URL]) {
    if (value) configuredNames.push(decodeURIComponent(new URL(value).pathname.slice(1)));
  }
  for (const path of ['api/runtime/config/database.json', 'api/runtime/state/database.json',
    process.env.YAYA_SETTINGS_PATH, process.env.YAYA_API_RUNTIME_ROOT && join(process.env.YAYA_API_RUNTIME_ROOT, 'state/database.json')].filter(Boolean)) {
    try { configuredNames.push(JSON.parse(readFileSync(join(root, path), 'utf8')).database?.database); } catch {}
  }
  if (configuredNames.includes(name)) throw new Error('Refusing a configured development/production/test database');
  if (sql(url, "SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema');") !== '0')
    throw new Error('Acceptance database must be empty; existing objects will never be removed');
  fixture = mkdtempSync(join(tmpdir(), 'agent-v2-fresh-'));
  const target = resolve(process.env.CARGO_TARGET_DIR || join(root, 'agent-v2/target/validation'));
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const api = process.env.AGENT_V2_FRESH_API_BINARY || join(target, `debug/yaya-api${suffix}`);
  const worker = join(target, `debug/yaya-agent-v2-worker${suffix}`);
  const env = { ...process.env, DATABASE_URL: url.toString(), APP_ENV: 'development', APP_HOST: '127.0.0.1',
    VALKEY_URL: '', YAYA_API_RUNTIME_ROOT: fixture, YAYA_SETTINGS_PATH: join(fixture, 'database.json'),
    YAYA_SKILLS_PATH: join(fixture, 'skills'), YAYA_UPLOAD_DIR: join(fixture, 'uploads'),
    YAYA_LOG_DIRECTORY: join(fixture, 'logs'), YAYA_LICENSE_SETTINGS_PATH: join(fixture, 'license.json'),
    YAYA_INSTALLED_AI_EMPLOYEES_PATH: join(fixture, 'employees.json'), YAYA_INSTALLED_AI_EMPLOYEE_PACKAGES_PATH: join(fixture, 'packages.json'),
    YAYA_AGENT_V2_WORKER_SECRET: 'isolated-fresh-database-acceptance-secret',
    AUTH_TOKEN_SECRET: 'isolated-fresh-database-acceptance-auth' };
  for (const pass of ['migrate', 'repeat']) {
    stage = pass; await exited(launch(api, ['--migrate-only'], env, pass));
    report.migrations.push(sql(url, 'SELECT count(*) FROM seaql_migrations;'));
  }
  if (report.migrations[0] !== report.migrations[1]) throw new Error('Repeated migration changed migration count');
  if (sql(url, "SELECT count(*) FROM seaql_migrations WHERE version='m20261102_000106_agent_v2_executions';") !== '1')
    throw new Error('Execution migration missing');
  stage = 'startup';
  const probe = createServer();
  await new Promise((ok, fail) => { probe.once('error', fail); probe.listen(0, '127.0.0.1', ok); });
  const port = probe.address().port;
  await new Promise(ok => probe.close(ok));
  env.APP_PORT = String(port); env.YAYA_AGENT_V2_API_URL = `http://127.0.0.1:${port}`;
  env.YAYA_AGENT_V2_CORDIS_HOST = join(root, 'agent-v2/cordis-host/src/host.mjs');
  const server = launch(api, [], env, 'api');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) break;
    try { if ((await fetch(`${env.YAYA_AGENT_V2_API_URL}/healthz`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await delay(500);
  }
  if (!ready) throw new Error('Fresh API readiness failed');
  const runner = launch(worker, [], env, 'worker');
  await delay(3000);
  if (runner.exitCode !== null || !readFileSync(join(resultDir, 'worker.log'), 'utf8').includes('Agent V2 worker ready'))
    throw new Error('Fresh Worker readiness failed');
  report.status = 'passed';
} catch (error) {
  report.status = stage === 'preflight' ? 'blocked' : 'failed';
  // Never serialize raw database URLs or child stderr to the terminal/report.
  report.reason = error.message.includes('postgres') ? 'Database preflight failed' : error.message;
  process.exitCode = report.status === 'blocked' ? 2 : 1;
} finally {
  for (const child of children) if (child.exitCode === null && child.pid) {
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else child.kill('SIGTERM');
  }
  for (const fd of handles) closeSync(fd);
  for (const label of ['migrate','repeat','api','worker']) for (const suffix of ['', '-error']) {
    const path = join(resultDir, `${label}${suffix}.log`);
    if (existsSync(path)) {
      let log = readFileSync(path, 'utf8');
      for (const value of redactions.filter(Boolean).sort((a,b) => b.length-a.length)) log = log.split(value).join('[REDACTED]');
      writeFileSync(path, log);
    }
  }
  // No database deletion: preserve the dedicated fixture for diagnosis.
  if (fixture) rmSync(fixture, { recursive: true, force: true });
  report.stage = stage; report.finishedAt = new Date().toISOString();
  writeFileSync(join(resultDir, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
