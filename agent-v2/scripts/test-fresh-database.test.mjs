import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./test-fresh-database.mjs', import.meta.url));
for (const [label, value] of [
  ['missing explicit target', ''],
  ['ordinary application database', 'postgres://test:do-not-log@127.0.0.1/yaya'],
  ['search path override', 'postgres://test:do-not-log@127.0.0.1/agent_v2_acceptance_fixture?options=x'],
  ['configured database', 'postgres://test:do-not-log@127.0.0.1/agent_v2_acceptance_fixture'],
]) {
  test(`fresh preflight rejects ${label} before connecting`, () => {
    const env = { ...process.env, AGENT_V2_FRESH_DATABASE_URL: value,
      DATABASE_URL: 'postgres://test:do-not-log@localhost/agent_v2_acceptance_fixture' };
    const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
    assert.equal(result.status, 2);
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.status, 'blocked');
    assert.equal(report.stage, 'preflight');
    assert.equal(result.stdout.includes('do-not-log'), false);
    assert.equal(result.stderr.includes('do-not-log'), false);
  });
}
