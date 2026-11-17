import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

function address(value) {
  if (!value) return undefined;
  const url = new URL(value.includes('://') ? value : `http://${value}`);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Windows 系统代理不是有效的 HTTP(S) 代理地址');
  }
  return url.toString().replace(/\/$/, '');
}

export function environmentWithSystemProxy(env, settings) {
  // Explicit process proxy configuration takes precedence over OS settings.
  if (Object.entries(env).some(([key, value]) => /^(https?_proxy|all_proxy)$/i.test(key) && value?.trim())) return { ...env };
  if (!settings?.ProxyEnable || typeof settings.ProxyServer !== 'string' || !settings.ProxyServer.trim()) return { ...env };
  const server = settings.ProxyServer.trim();
  let http, https;
  if (server.includes('=')) {
    const entries = Object.fromEntries(server.split(';').map(item => item.trim().split(/=(.*)/s).slice(0, 2)).filter(item => item.length === 2).map(([key, value]) => [key.toLowerCase(), value]));
    http = address(entries.http);
    https = address(entries.https);
  } else {
    http = https = address(server);
  }
  return {
    ...env,
    ...(http ? { HTTP_PROXY: http } : {}),
    ...(https ? { HTTPS_PROXY: https } : {}),
    ...(!Object.keys(env).some(key => /^no_proxy$/i.test(key)) && (http || https) ? { NO_PROXY: 'localhost,127.0.0.1,::1' } : {}),
  };
}

export function environmentWithDesktopProxy(env, settings) {
  if (settings?.ProxyHTTPMode !== 'manual') return { ...env };
  const http = settings.OverrideProxyHTTP?.trim();
  const https = settings.OverrideProxyHTTPS?.trim();
  if (!http && !https) return { ...env };
  return environmentWithSystemProxy(env, {
    ProxyEnable: 1,
    ProxyServer: [http && `http=${http}`, https && `https=${https}`].filter(Boolean).join(';'),
  });
}

export async function dockerEnvironment(env = process.env, platform = process.platform) {
  if (platform !== 'win32' || Object.entries(env).some(([key, value]) => /^(https?_proxy|all_proxy)$/i.test(key) && value?.trim())) return { ...env };
  const powershell = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = "$ErrorActionPreference='Stop'; Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' | Select-Object ProxyEnable,ProxyServer | ConvertTo-Json -Compress";
  let settings;
  try {
    const { stdout } = await execute(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { env, timeout: 5000, windowsHide: true, maxBuffer: 16384 });
    settings = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  } catch (error) {
    throw new Error(`无法读取 Windows 系统代理，请配置 HTTP_PROXY/HTTPS_PROXY 后重试：${error.message}`);
  }
  // BuildKit obtains registry tokens in the CLI process, independently of the daemon.
  // Match Desktop's explicit proxy even when the Windows system proxy is disabled.
  if (env.APPDATA) {
    let desktop;
    try { desktop = JSON.parse(await readFile(path.join(env.APPDATA, 'Docker', 'settings-store.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(`无法读取 Docker Desktop 代理配置：${error.message}`); }
    if (desktop?.ProxyHTTPMode === 'manual') return environmentWithDesktopProxy(env, desktop);
  }
  return environmentWithSystemProxy(env, settings);
}
