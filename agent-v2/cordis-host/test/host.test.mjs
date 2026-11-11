import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

function host(t) {
  const child = spawn(process.execPath, ['src/host.mjs'], { cwd: new URL('..', import.meta.url), stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let seq = 0;
  child.stderr.on('data', () => {});
  createInterface({ input: child.stdout }).on('line', line => {
    const frame = JSON.parse(line); const pair = pending.get(frame.id);
    if (pair) { pending.delete(frame.id); frame.error ? pair.reject(new Error(frame.error.message)) : pair.resolve(frame.result); }
  });
  child.on('exit', () => { for (const pair of pending.values()) pair.reject(new Error('host exited')); pending.clear(); });
  t.after(() => child.kill());
  return { child, rpc(method, params = {}) { return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  }); } };
}

test('real Cordis injection, concurrent correlation, invocation, cancellation and unload', { timeout: 10000 }, async t => {
  const h = host(t);
  await assert.rejects(h.rpc('health.check'), /initialize/);
  await assert.rejects(h.rpc('host.initialize', { protocolVersion: 9 }), /unsupported/);
  assert.equal((await h.rpc('host.initialize', { protocolVersion: 1 })).cordisVersion, '4.0.0-rc.12');
  assert.equal((await h.rpc('capability.list')).tools[0].name, 'diagnostic_echo');
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => h.rpc('tool.invoke', {
    invocationId: String(i), name: 'diagnostic_echo', arguments: { text: String(i) }, scope: { runId: 'test' },
  })));
  assert.deepEqual(results.map(r => r.text), Array.from({ length: 8 }, (_, i) => String(i)));
  assert.ok(results.every(r => r.source === 'cordis'));
  await assert.rejects(h.rpc('tool.invoke', { invocationId: 'invalid', name: 'diagnostic_echo', arguments: { text: 42 }, scope: {} }), /invalid/);
  assert.equal((await h.rpc('invocation.cancel', { invocationId: 'missing' })).accepted, true);
  h.child.stdin.cork();
  const cancelled = h.rpc('tool.invoke', { invocationId: 'cancel-me', name: 'diagnostic_echo', arguments: { text: 'cancel' }, scope: {} });
  const rejected = assert.rejects(cancelled, /aborted/);
  const cancelAck = h.rpc('invocation.cancel', { invocationId: 'cancel-me' });
  h.child.stdin.uncork();
  await Promise.all([cancelAck, rejected]);
  assert.equal((await h.rpc('plugin.dispose')).remainingTools, 0);
  await assert.rejects(h.rpc('tool.invoke', { invocationId: 'after', name: 'diagnostic_echo', arguments: { text: 'x' }, scope: {} }), /unavailable/);
});

test('oversized frame terminates host; fresh process can initialize', { timeout: 10000 }, async t => {
  const h = host(t);
  const exited = new Promise(resolve => h.child.once('exit', resolve));
  h.child.stdin.on('error', () => {});
  h.child.stdin.end('x'.repeat(1024 * 1024 + 1));
  assert.equal(await exited, 1);
  const fresh = host(t);
  assert.equal((await fresh.rpc('host.initialize', { protocolVersion: 1 })).protocolVersion, 1);
});
