"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@heroui/react";

type ApiEnvelope<T> = { code: number; message: string; data: T | null };
type RoleItem = { id: string; sourceType: string; externalId: string; name: string; groupName: string | null; status: string; memberCount: number };

export default function RolesSettingsPage() {
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadRoles = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/identity/roles", { cache: "no-store" });
      const payload = (await response.json()) as ApiEnvelope<RoleItem[]>;
      if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(payload.message || "无法加载角色");
      setRoles(payload.data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法加载角色"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRoles(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRoles]);

  return (
    <section className="theme-panel h-full min-h-0 overflow-y-auto overscroll-contain rounded-[24px] p-6 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-lg font-semibold text-[var(--color-text-primary)]">角色管理</h2><p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">查看平台角色以及第三方身份源同步的角色和成员数量。</p></div>
        <Button variant="secondary" isDisabled={loading} onPress={() => void loadRoles()}>{loading ? "正在刷新…" : "刷新数据"}</Button>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Metric label="全部角色" value={String(roles.length)} />
        <Metric label="已启用" value={String(roles.filter((role) => role.status === "active").length)} />
        <Metric label="钉钉角色" value={String(roles.filter((role) => role.sourceType === "dingtalk").length)} />
      </div>
      {error ? <p className="mt-5 rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">{error}</p> : null}
      <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--color-border)]">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(160px,1fr)_100px_90px] gap-3 border-b border-[var(--color-border)] bg-[var(--color-control-soft)] px-4 py-3 text-xs font-semibold text-[var(--color-text-secondary)]"><div>角色</div><div>角色组</div><div>成员</div><div>状态</div></div>
        {roles.map((role) => <div key={role.id} className="grid grid-cols-[minmax(0,1fr)_minmax(160px,1fr)_100px_90px] items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 last:border-b-0"><div className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium text-[var(--color-text-primary)]">{role.name}</span><SourceTag source={role.sourceType} /></div><div className="truncate text-xs text-[var(--color-text-secondary)]">{role.groupName || "—"}</div><div className="text-xs text-[var(--color-text-secondary)]">{role.memberCount}</div><div className={role.status === "active" ? "text-xs text-[var(--color-success)]" : "text-xs text-[var(--color-text-disabled)]"}>{role.status === "active" ? "启用" : "停用"}</div></div>)}
        {!loading && roles.length === 0 ? <div className="px-5 py-10 text-center text-sm text-[var(--color-text-secondary)]">暂无角色，钉钉用户同步后会自动生成角色数据。</div> : null}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-control-soft)] p-4"><div className="text-xs text-[var(--color-text-secondary)]">{label}</div><div className="mt-2 text-xl font-semibold text-[var(--color-text-primary)]">{value}</div></div>; }
function SourceTag({ source }: { source: string }) { return source === "dingtalk" ? <span className="shrink-0 rounded-full bg-[#eaf2ff] px-2 py-0.5 text-[10px] font-semibold text-[#1677ff]">钉钉</span> : <span className="shrink-0 rounded-full bg-[var(--color-primary-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">平台</span>; }
