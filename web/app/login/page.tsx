"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card, Input, Tabs, toast } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { CompactThemeSwitcher } from "../components/ThemeSwitcherMenu";
import { AUTH_TOKEN_STORAGE_KEY, AUTH_USER_STORAGE_KEY, type AuthUser, writeAuthStorage } from "../lib/auth";
import { getAuthSession, loginWithPassword } from "@features/auth/api";

type LoginMode = "password" | "sms" | "dingtalk";
type LoginResponse = {
  code: number;
  message: string;
  data: null | {
    token: string;
    expiresAt: string;
    user: { id: string; displayName: string; username: string };
  };
};

const REMEMBERED_CREDENTIALS_KEY = "yaya-remembered-credentials";
type RememberedCredentials = { username: string; password: string; autoLogin: boolean };

export default function LoginPage() {
  return <Suspense fallback={null}><LoginScreen /></Suspense>;
}

function LoginScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [mode, setMode] = useState<LoginMode>("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mobile, setMobile] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [sendingSms, setSendingSms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const [autoLogin, setAutoLogin] = useState(false);
  const autoLoginAttempted = useRef(false);
  const dingtalkError = searchParams.get("dingtalkError") ?? "";
  const activeMode: LoginMode = dingtalkError ? "dingtalk" : mode;
  const visibleError = dingtalkError || error;

  useEffect(() => {
    if (smsCountdown <= 0) return;
    const timer = window.setInterval(() => setSmsCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [smsCountdown]);

  const completeLogin = useCallback((token: string, user: AuthUser) => {
    writeAuthStorage(AUTH_TOKEN_STORAGE_KEY, token);
    writeAuthStorage(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
    setIsAuthenticated(true);
  }, []);

  async function login(nextUsername: string, nextPassword: string, shouldRememberPassword: boolean, shouldAutoLogin: boolean) {
    const payload = await loginWithPassword<NonNullable<LoginResponse["data"]>>(nextUsername, nextPassword);
    saveRememberedCredentials(nextUsername, nextPassword, shouldRememberPassword, shouldAutoLogin);
    completeLogin(payload.token, payload.user);
    router.replace(getSafeRedirect());
  }

  async function sendSmsCode() {
    const normalized = mobile.trim();
    if (!/^1\d{10}$/.test(normalized)) { toast.danger("请输入正确的手机号"); return; }
    if (smsCountdown > 0 || sendingSms) return;
    setSendingSms(true); setError("");
    try {
      const response = await fetch("/api/auth/sms/send-code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mobile: normalized }) });
      const payload = await response.json() as { code: number; message: string };
      if (!response.ok || payload.code !== 0) throw new Error(payload.message || "验证码发送失败");
      setSmsCountdown(60);
    } catch (reason) { toast.danger(reason instanceof Error ? reason.message : "验证码发送失败"); }
    finally { setSendingSms(false); }
  }

  async function smsLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/auth/sms/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mobile: mobile.trim(), code: smsCode.trim() }) });
      const payload = await response.json() as LoginResponse;
      if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(payload.message || "登录失败，请稍后重试");
      completeLogin(payload.data.token, payload.data.user); router.replace(getSafeRedirect());
    } catch (reason) { toast.danger(reason instanceof Error ? reason.message : "登录失败，请稍后重试"); }
    finally { setSubmitting(false); }
  }

  useEffect(() => {
    if (isReady && isAuthenticated) router.replace(getSafeRedirect());
  }, [isAuthenticated, isReady, router]);

  useEffect(() => {
    let cancelled = false;
    void getAuthSession<NonNullable<LoginResponse["data"]>>()
      .then((payload) => {
        if (!cancelled) completeLogin(payload.token, payload.user);
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setIsReady(true); });
    return () => { cancelled = true; };
  }, [completeLogin]);

  // WebView password managers can restore input values without dispatching
  // input/change events. Keep React state in sync so the submit button does
  // not remain disabled while the fields visibly contain credentials.
  useEffect(() => {
    if (!isReady || isAuthenticated) return;
    const remembered = readRememberedCredentials();
    if (!remembered) return;
    // Reconcile credentials restored by the WebView password manager.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUsername((current) => current || remembered.username);
    setPassword((current) => current || remembered.password);
    setRememberPassword(true);
    setAutoLogin(remembered.autoLogin);
  }, [isAuthenticated, isReady]);

  useEffect(() => {
    if (isAuthenticated || searchParams.get("dingtalkComplete") !== "1") return;
    void getAuthSession<NonNullable<LoginResponse["data"]>>()
      .then((payload) => {
        completeLogin(payload.token, payload.user);
        router.replace(getSafeRedirect());
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "无法恢复钉钉登录会话"));
  }, [completeLogin, isAuthenticated, router, searchParams]);

  useEffect(() => {
    if (!isReady || isAuthenticated || autoLoginAttempted.current || searchParams.get("dingtalkComplete") === "1" || dingtalkError) return;
    autoLoginAttempted.current = true;
    const remembered = readRememberedCredentials();
    if (!remembered?.autoLogin) return;
    const timer = window.setTimeout(() => {
      void login(remembered.username, remembered.password, true, true);
    }, 0);
    return () => window.clearTimeout(timer);
  // The login function intentionally reads the latest credentials from this effect invocation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dingtalkError, isAuthenticated, isReady, searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError("");
    try {
      await login(username, password, rememberPassword, autoLogin);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex h-[100dvh] min-h-[620px] overflow-hidden p-3 sm:p-6">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-[var(--color-primary-soft)] opacity-80 blur-3xl" />
        <div className="absolute -bottom-32 -right-20 h-96 w-96 rounded-full bg-[var(--color-accent-soft)] opacity-75 blur-3xl" />
        <div className="absolute left-[48%] top-[18%] h-52 w-52 rounded-full bg-[var(--color-secondary-soft)] opacity-60 blur-3xl" />
      </div>

      <div className="relative mx-auto grid h-full w-full overflow-hidden rounded-[32px] border border-[var(--glass-border)] bg-[var(--glass-background)] shadow-[var(--glass-shadow)] backdrop-blur-2xl lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden flex-col justify-between overflow-hidden border-r border-[var(--color-border)] p-10 lg:flex xl:p-14">
          <div>
            <Brand />
            <div className="mt-24 max-w-xl">
              <p className="text-sm font-semibold tracking-[0.18em] text-[var(--color-primary)]">YAYA LOWCODE</p>
              <h1 className="mt-5 text-4xl font-semibold leading-tight text-[var(--color-text-primary)] xl:text-5xl">
                让业务构建，
                <br />
                保持简单而清晰。
              </h1>
              <p className="mt-6 max-w-lg text-base leading-8 text-[var(--color-text-secondary)]">
                在统一工作台中设计表单、连接数据、编排自动化，并让团队协作自然发生。
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <FeatureStat value="统一" label="用户与身份源" />
            <FeatureStat value="灵活" label="表单与流程" />
            <FeatureStat value="安全" label="登录状态隔离" />
          </div>
        </section>

        <section className="flex min-h-0 flex-col bg-[var(--color-bg-panel)] p-5 sm:p-8 lg:p-10 xl:p-14">
          <div className="flex items-center justify-between lg:justify-end">
            <div className="lg:hidden"><Brand /></div>
            <CompactThemeSwitcher />
          </div>

          <div className="flex flex-1 items-center justify-center py-6">
            <Card className="w-full max-w-[430px] min-h-[560px] rounded-[26px] border border-[var(--color-border-card-glass)] bg-[var(--color-bg-card-glass)] p-6 shadow-[var(--shadow-card-glass)] backdrop-blur-xl sm:p-8">
              <div>
                <p className="text-sm font-medium text-[var(--color-primary)]">欢迎回来</p>
                <h2 className="mt-2 text-3xl font-semibold text-[var(--color-text-primary)]">登录丫丫 LowCode</h2>
                <p className="mt-3 ">
                  选择一种身份验证方式进入工作台。
                </p>
              </div>

              <Tabs selectedKey={activeMode} onSelectionChange={(key) => { setMode(String(key) as LoginMode); setError(""); if (dingtalkError) router.replace("/login"); }} className="mt-7">
                <Tabs.ListContainer>
                  <Tabs.List aria-label="登录方式" className="grid w-full grid-cols-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-1">
                    <Tabs.Tab id="password" className="py-2 text-sm">账号密码<Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="sms" className="py-2 text-sm">短信登录<Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="dingtalk" className="py-2 text-sm">钉钉扫码<Tabs.Indicator /></Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>
              </Tabs>

              <div className="mt-6 min-h-[390px]">
              {activeMode === "password" ? (
                <form className="space-y-5" onSubmit={handleSubmit}>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]">账号</span>
                    <Input
                      autoComplete="username"
                      autoFocus
                      fullWidth
                      placeholder="请输入账号"
                      value={username}
                      onChange={(event) => setUsername(event.currentTarget.value)}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]">密码</span>
                    <div className="relative">
                      <Input
                        autoComplete="current-password"
                        fullWidth
                        placeholder="请输入密码"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.currentTarget.value)}
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? "隐藏密码" : "显示密码"}
                        className="absolute right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                        onClick={() => setShowPassword((current) => !current)}
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </div>
                  </label>

                  {visibleError ? (
                    <p role="alert" className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] px-3 py-2.5 text-sm text-[var(--color-danger)]">
                      {visibleError}
                    </p>
                  ) : null}

                  <Button
                    fullWidth
                    type="submit"
                    variant="primary"
                    isDisabled={submitting || !username.trim() || !password}
                    className="h-11 shadow-[var(--shadow-primary)]"
                  >
                    {submitting ? "正在登录…" : "登录"}
                  </Button>

                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--color-text-secondary)]">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={rememberPassword}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setRememberPassword(checked);
                          if (!checked) setAutoLogin(false);
                        }}
                      />
                      记住密码
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={autoLogin}
                        disabled={!rememberPassword}
                        onChange={(event) => setAutoLogin(event.currentTarget.checked)}
                      />
                      自动登录
                    </label>
                  </div>

                  {process.env.NODE_ENV !== "production" ? (
                    <p className="text-center text-xs text-[var(--color-text-disabled)]">
                      开发环境默认账号：yaya / yaya
                    </p>
                  ) : null}
                </form>
              ) : activeMode === "sms" ? (
                <form className="space-y-5" onSubmit={smsLogin}>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]">手机号</span>
                    <Input autoComplete="tel" autoFocus fullWidth inputMode="tel" maxLength={11} placeholder="请输入手机号" value={mobile} onChange={(event) => setMobile(event.currentTarget.value.replace(/\D/g, ""))} />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]">短信验证码</span>
                    <div className="flex gap-2">
                      <Input className="min-w-0 flex-1" autoComplete="one-time-code" inputMode="numeric" maxLength={6} placeholder="请输入 6 位验证码" value={smsCode} onChange={(event) => setSmsCode(event.currentTarget.value.replace(/\D/g, ""))} />
                      <Button type="button" variant="secondary" className="h-11 min-w-[112px] shrink-0" isDisabled={sendingSms || smsCountdown > 0 || !/^1\d{10}$/.test(mobile)} onPress={() => void sendSmsCode()}>
                        {sendingSms ? "发送中…" : smsCountdown > 0 ? `${smsCountdown} 秒后重试` : "获取验证码"}
                      </Button>
                    </div>
                  </label>
                  <Button fullWidth type="submit" variant="primary" isDisabled={submitting || !/^1\d{10}$/.test(mobile) || !/^\d{6}$/.test(smsCode)} className="h-11 shadow-[var(--shadow-primary)]">
                    {submitting ? "正在登录…" : "登录"}
                  </Button>
                  <p className="text-center text-xs text-[var(--color-text-secondary)]">未绑定手机号的用户无法使用短信登录</p>
                </form>
              ) : (
                <div className="flex min-h-[390px] flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-panel-soft)] px-6 text-center">
                  <div className="grid h-32 w-32 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-sm)]">
                    <QrPlaceholder />
                  </div>
                  <h3 className="mt-5 text-base font-semibold text-[var(--color-text-primary)]">钉钉扫码登录</h3>
                  <p className="mt-2 max-w-xs ">
                    将跳转至钉钉完成扫码授权，并安全返回本平台。
                  </p>
                  {visibleError ? (
                    <p role="alert" className="mt-4 max-w-xs rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] px-3 py-2.5 text-sm text-[var(--color-danger)]">
                      {visibleError}
                    </p>
                  ) : null}
                  <Button
                    variant="primary"
                    className="mt-5"
                    onPress={() => {
                      const redirect = getSafeRedirect();
                      window.location.assign(`/api/auth/dingtalk?redirect=${encodeURIComponent(redirect)}`);
                    }}
                  >
                    使用钉钉扫码
                  </Button>
                </div>
              )}
              </div>
            </Card>
          </div>

          <p className="text-center text-xs text-[var(--color-text-disabled)]">登录即表示你已获得使用本平台的授权</p>
        </section>
      </div>
    </main>
  );
}

function getSafeRedirect() {
  if (typeof window === "undefined") return "/";
  const redirect = new URLSearchParams(window.location.search).get("redirect");
  return redirect
    && redirect.startsWith("/")
    && !redirect.startsWith("//")
    && !redirect.startsWith("/login")
    ? redirect
    : "/";
}

function readRememberedCredentials(): RememberedCredentials | null {
  try {
    const value = window.localStorage.getItem(REMEMBERED_CREDENTIALS_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<RememberedCredentials>;
    return typeof parsed.username === "string" && typeof parsed.password === "string" && typeof parsed.autoLogin === "boolean"
      ? { username: parsed.username, password: parsed.password, autoLogin: parsed.autoLogin }
      : null;
  } catch {
    return null;
  }
}

function saveRememberedCredentials(username: string, password: string, rememberPassword: boolean, autoLogin: boolean) {
  try {
    if (!rememberPassword) {
      window.localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY);
      return;
    }
    window.localStorage.setItem(REMEMBERED_CREDENTIALS_KEY, JSON.stringify({ username, password, autoLogin }));
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--color-primary)] text-sm font-bold tracking-[0.16em] text-[var(--color-text-on-primary)] shadow-[var(--shadow-primary)]">YY</span>
      <span>
        <span className="block text-base font-semibold text-[var(--color-text-primary)]">丫丫 LowCode</span>
        <span className="block text-xs text-[var(--color-text-secondary)]">业务应用构建平台</span>
      </span>
    </div>
  );
}

function FeatureStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-control-soft)] p-4 backdrop-blur-xl">
      <p className="text-lg font-semibold text-[var(--color-text-primary)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{label}</p>
    </div>
  );
}

function EyeIcon() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
}

function EyeOffIcon() {
  return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m3 3 18 18M10.6 6.2A9.9 9.9 0 0 1 12 6c6 0 9.5 6 9.5 6a15.4 15.4 0 0 1-2.4 3.1M6.2 6.2C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6a9.7 9.7 0 0 0 3.3-.6M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>;
}

function QrPlaceholder() {
  return <svg viewBox="0 0 64 64" className="h-24 w-24 text-[var(--color-text-primary)]" fill="currentColor"><path d="M5 5h22v22H5V5Zm5 5v12h12V10H10Zm27-5h22v22H37V5Zm5 5v12h12V10H42ZM5 37h22v22H5V37Zm5 5v12h12V42H10Zm27-5h7v7h-7v-7Zm9 0h13v7H46v-7Zm-9 9h7v13h-7V46Zm9 0h7v7h-7v-7Zm9 0h4v13h-4V46Zm-9 9h7v4h-7v-4Z" /></svg>;
}
