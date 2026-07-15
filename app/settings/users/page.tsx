"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input } from "@heroui/react";

type ApiEnvelope<T> = { code: number; message: string; data: T | null };
type UserItem = {
  id: string;
  displayName: string;
  mobile: string | null;
  stateCode: string | null;
  telephone: string | null;
  email: string | null;
  jobNumber: string | null;
  title: string | null;
  workPlace: string | null;
  remark: string | null;
  hiredAt: string | null;
  tenureMonths: number | null;
  managerName: string | null;
  primaryDepartment: string | null;
  senior: boolean;
  isAdmin: boolean;
  isBoss: boolean;
  realAuthed: boolean;
  extensionJson: unknown;
  status: string;
  sourceType: string;
  departments: string[];
  roles: string[];
};
type SourceFilter = "all" | "local" | "dingtalk";
type StatusFilter = "all" | "active" | "inactive";

export default function UsersSettingsPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/identity/users", { cache: "no-store" });
      const payload = (await response.json()) as ApiEnvelope<UserItem[]>;
      if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(payload.message || "无法加载用户");
      setUsers(payload.data);
      setSelectedId((current) => current && payload.data!.some((user) => user.id === current) ? current : payload.data![0]?.id || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载用户");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return users.filter((user) => {
      if (sourceFilter !== "all" && user.sourceType !== sourceFilter) return false;
      if (statusFilter !== "all" && user.status !== statusFilter) return false;
      if (!normalized) return true;
      return [user.displayName, user.mobile, user.email, user.jobNumber, user.title, ...user.departments, ...user.roles]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("zh-CN").includes(normalized));
    });
  }, [query, sourceFilter, statusFilter, users]);
  const selectedUser = users.find((user) => user.id === selectedId) || null;

  return (
    <section className="theme-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] shadow-[var(--shadow-card)]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
        <div>
          <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-[var(--color-text-primary)]">用户管理</h2><span className="rounded-full bg-[var(--color-success-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-success)]">公开注册已关闭</span></div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">共 {users.length} 人 · 启用 {users.filter((user) => user.status === "active").length} 人 · 钉钉 {users.filter((user) => user.sourceType === "dingtalk").length} 人</p>
        </div>
        <div className="flex items-center gap-2">
          <Input aria-label="搜索用户" className="w-64" placeholder="搜索姓名、部门、角色或手机号" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          <Button variant="secondary" isDisabled={loading} onPress={() => void loadUsers()}>{loading ? "刷新中…" : "刷新"}</Button>
        </div>
      </div>

      {error ? <p className="mx-5 mt-4 rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">{error}</p> : null}

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex overflow-hidden">
        <div className="settings-scroll-area h-full w-[180px] shrink-0 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-control-soft)] p-3 overscroll-contain">
          <FilterGroup label="用户来源">
            <FilterButton label="全部用户" count={users.length} active={sourceFilter === "all"} onPress={() => setSourceFilter("all")} />
            <FilterButton label="平台账号" count={users.filter((user) => user.sourceType === "local").length} active={sourceFilter === "local"} onPress={() => setSourceFilter("local")} />
            <FilterButton label="钉钉" count={users.filter((user) => user.sourceType === "dingtalk").length} active={sourceFilter === "dingtalk"} onPress={() => setSourceFilter("dingtalk")} />
          </FilterGroup>
          <FilterGroup label="账号状态">
            <FilterButton label="全部状态" count={users.length} active={statusFilter === "all"} onPress={() => setStatusFilter("all")} />
            <FilterButton label="已启用" count={users.filter((user) => user.status === "active").length} active={statusFilter === "active"} onPress={() => setStatusFilter("active")} />
            <FilterButton label="已停用" count={users.filter((user) => user.status !== "active").length} active={statusFilter === "inactive"} onPress={() => setStatusFilter("inactive")} />
          </FilterGroup>
        </div>

        <div className="settings-scroll-area h-full min-h-0 min-w-0 flex-1 overflow-y-scroll overscroll-contain">
          <div className="sticky top-0 z-10 grid min-w-[760px] grid-cols-[minmax(180px,1.15fr)_minmax(150px,1fr)_minmax(150px,1fr)_120px] gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-3 text-xs font-semibold text-[var(--color-text-secondary)]">
            <div>用户</div><div>组织</div><div>角色</div><div>状态</div>
          </div>
          {filteredUsers.map((user) => (
            <Button fullWidth variant="ghost" key={user.id} className={`grid h-auto min-w-[760px] grid-cols-[minmax(180px,1.15fr)_minmax(150px,1fr)_minmax(150px,1fr)_120px] items-center gap-3 rounded-none border-b border-[var(--color-border)] px-4 py-3 text-left ${selectedId === user.id ? "bg-[var(--color-primary-soft)]" : "hover:bg-[var(--color-bg-hover)]"}`} onPress={() => setSelectedId(user.id)}>
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary-soft)] text-sm font-semibold text-[var(--color-primary)]">{user.displayName.slice(0, 1)}</span>
                <div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate text-sm font-medium text-[var(--color-text-primary)]">{user.displayName}</span><SourceTag source={user.sourceType} /></div><div className="mt-0.5 truncate text-[11px] text-[var(--color-text-secondary)]">{user.title || user.mobile || user.email || user.jobNumber || "—"}</div></div>
              </div>
              <TagList values={user.departments} empty="未分配组织" />
              <TagList values={user.roles} empty="未分配角色" />
              <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-semibold ${user.status === "active" ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-control-soft)] text-[var(--color-text-disabled)]"}`}>{user.status === "active" ? "已启用" : "已停用"}</span>
            </Button>
          ))}
          {!loading && filteredUsers.length === 0 ? <div className="flex min-h-64 items-center justify-center text-sm text-[var(--color-text-secondary)]">没有符合当前条件的用户。</div> : null}
        </div>
        <aside className="settings-scroll-area h-full w-[300px] shrink-0 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-control-soft)] p-5 overscroll-contain">
          {selectedUser ? <UserDetails user={selectedUser} /> : <div className="text-sm text-[var(--color-text-secondary)]">选择一个用户查看完整资料。</div>}
        </aside>
        </div>
      </div>
    </section>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) { return <div className="mb-5"><div className="mb-2 px-2 text-[11px] font-semibold text-[var(--color-text-secondary)]">{label}</div><div className="space-y-1">{children}</div></div>; }
function FilterButton({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) { return <Button fullWidth variant="ghost" className={`justify-between rounded-xl px-3 ${active ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "text-[var(--color-text-primary)]"}`} onPress={onPress}><span>{label}</span><span className="text-xs opacity-65">{count}</span></Button>; }
function TagList({ values, empty }: { values: string[]; empty: string }) { return values.length ? <div className="flex min-w-0 flex-wrap gap-1">{values.slice(0, 2).map((value) => <span key={value} className="max-w-36 truncate rounded-lg bg-[var(--color-control-soft)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)]">{value}</span>)}{values.length > 2 ? <span className="rounded-lg bg-[var(--color-control-soft)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)]">+{values.length - 2}</span> : null}</div> : <span className="text-xs text-[var(--color-text-disabled)]">{empty}</span>; }
function SourceTag({ source }: { source: string }) { return source === "dingtalk" ? <span className="shrink-0 rounded-full bg-[#eaf2ff] px-2 py-0.5 text-[10px] font-semibold text-[#1677ff]">钉钉</span> : <span className="shrink-0 rounded-full bg-[var(--color-primary-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">平台</span>; }

function UserDetails({ user }: { user: UserItem }) {
  return (
    <>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-primary-soft)] text-lg font-semibold text-[var(--color-primary)]">{user.displayName.slice(0, 1)}</div>
      <div className="mt-4 flex items-center gap-2"><h3 className="text-base font-semibold text-[var(--color-text-primary)]">{user.displayName}</h3><SourceTag source={user.sourceType} /></div>
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{user.title || "未设置职位"}</p>
      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
        <Detail label="邮箱" value={user.email} />
        <Detail label="手机号" value={[user.stateCode, user.mobile].filter(Boolean).join("-") || null} />
        <Detail label="主部门" value={user.primaryDepartment} />
        <Detail label="直属主管" value={user.managerName} />
        <Detail label="职务" value={user.roles.join("、") || null} />
        <Detail label="职位" value={user.title} />
        <Detail label="职级" value={findExtensionValue(user.extensionJson, ["职级", "jobLevel", "job_level"])} />
        <Detail label="旧职位" value={findExtensionValue(user.extensionJson, ["职位(升级前字段)", "legacyPosition", "old_title"])} />
        <Detail label="工号" value={user.jobNumber} />
        <Detail label="分机号" value={user.telephone} />
        <Detail label="办公地点" value={user.workPlace} />
        <Detail label="入职时间" value={user.hiredAt ? new Date(user.hiredAt).toLocaleDateString("zh-CN") : null} />
        <Detail label="司龄" value={formatTenure(user.tenureMonths)} />
        <Detail label="实名状态" value={user.realAuthed ? "已实名" : "未实名"} />
      </div>
      <div className="mt-5"><Detail label="全部部门" value={user.departments.join("、") || null} /></div>
      <div className="mt-4"><Detail label="备注" value={user.remark} /></div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) { return <div className="min-w-0"><div className="text-[10px] text-[var(--color-text-disabled)]">{label}</div><div className="mt-1 break-words text-xs font-medium text-[var(--color-text-primary)]">{value || "—"}</div></div>; }
function formatTenure(months: number | null) { if (months === null) return null; const years = Math.floor(months / 12); const rest = months % 12; return years > 0 ? `${years}年${rest}月` : `${rest}月`; }
function findExtensionValue(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (keys.some((candidate) => candidate.toLocaleLowerCase() === key.toLocaleLowerCase()) && (typeof item === "string" || typeof item === "number")) return String(item);
    const nested = findExtensionValue(item, keys);
    if (nested) return nested;
  }
  return null;
}
