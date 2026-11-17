import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockerEnvironment, environmentWithDesktopProxy, environmentWithSystemProxy } from './docker-proxy.mjs';

test('enabled Windows proxy configures both Docker CLI proxy protocols without changing the parent environment', () => {
  const env = { PATH: 'original' };
  assert.deepEqual(environmentWithSystemProxy(env, { ProxyEnable: 1, ProxyServer: '127.0.0.1:7897' }), {
    PATH: 'original', HTTP_PROXY: 'http://127.0.0.1:7897', HTTPS_PROXY: 'http://127.0.0.1:7897', NO_PROXY: 'localhost,127.0.0.1,::1',
  });
  assert.deepEqual(env, { PATH: 'original' });
});

test('supports per-protocol Windows proxies and preserves explicit bypasses', () => {
  const result = environmentWithSystemProxy({ NO_PROXY: 'local.test' }, { ProxyEnable: 1, ProxyServer: 'http=127.0.0.1:7897;https=127.0.0.1:7898;socks=127.0.0.1:7899' });
  assert.equal(result.HTTP_PROXY, 'http://127.0.0.1:7897');
  assert.equal(result.HTTPS_PROXY, 'http://127.0.0.1:7898');
  assert.equal(result.NO_PROXY, 'local.test');
});

test('explicit proxy variables take priority including lowercase keys', () => {
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'ALL_PROXY']) {
    const env = { [key]: 'http://explicit:8080' };
    assert.deepEqual(environmentWithSystemProxy(env, { ProxyEnable: 1, ProxyServer: '127.0.0.1:7897' }), env);
  }
});

test('disabled system proxy and non-Windows environments stay unchanged', async () => {
  assert.deepEqual(environmentWithSystemProxy({}, { ProxyEnable: 0, ProxyServer: '127.0.0.1:7897' }), {});
  assert.deepEqual(await dockerEnvironment({ PATH: '/usr/bin' }, 'linux'), { PATH: '/usr/bin' });
});

test('rejects malformed enabled proxy configuration instead of silently falling back to direct access', () => {
  assert.throws(() => environmentWithSystemProxy({}, { ProxyEnable: 1, ProxyServer: 'http://proxy.test/path' }), /有效/);
});

test('manual Desktop proxy also configures CLI token retrieval while system proxy is disabled', () => {
  const settings = { ProxyHTTPMode: 'manual', OverrideProxyHTTP: 'http://127.0.0.1:7897', OverrideProxyHTTPS: 'http://127.0.0.1:7897' };
  const result = environmentWithDesktopProxy({}, settings);
  assert.equal(result.HTTPS_PROXY, 'http://127.0.0.1:7897');
  assert.equal(result.HTTP_PROXY, 'http://127.0.0.1:7897');
  assert.deepEqual(environmentWithDesktopProxy({ https_proxy: 'http://explicit:8080' }, settings), { https_proxy: 'http://explicit:8080' });
  assert.deepEqual(environmentWithDesktopProxy({}, { ...settings, ProxyHTTPMode: 'system' }), {});
});
