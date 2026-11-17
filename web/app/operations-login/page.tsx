"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Card } from "@heroui/react";
import { useRouter } from "next/navigation";
import { loginWithOperations } from "@/features/auth/api";
import { AUTH_TOKEN_STORAGE_KEY, AUTH_USER_STORAGE_KEY, writeAuthStorage } from "@/shared/lib/auth";

export default function OperationsLogin() {
  const started = useRef(false);
  const [error, setError] = useState("");
  const router = useRouter();
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = new URLSearchParams(window.location.hash.slice(1)).get("code") ?? "";
    window.history.replaceState(null, "", window.location.pathname);
    void loginWithOperations(code).then((session) => {
      writeAuthStorage(AUTH_TOKEN_STORAGE_KEY, session.token);
      writeAuthStorage(AUTH_USER_STORAGE_KEY, JSON.stringify(session.user));
      // Reload to start the protected tree with the newly issued cookie.
      window.location.replace("/");
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "运维登录失败"));
  }, []);
  return <main className="flex min-h-screen items-center justify-center p-6"><Card className="w-full max-w-md p-6"><h1 className="text-lg font-semibold">平台运维访问</h1><p className="mt-3 text-sm">使用独立运维身份，本次访问及操作将记录审计，会话最长 30 分钟。</p><p role={error ? "alert" : "status"} className="mt-4 text-sm">{error || "正在验证一次性登录凭证…"}</p>{error ? <Button className="mt-4" onPress={() => router.replace("/login")}>返回登录</Button> : null}</Card></main>;
}
