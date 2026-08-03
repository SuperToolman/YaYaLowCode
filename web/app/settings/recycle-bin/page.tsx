"use client";

import { useEffect, useState } from "react";
import { Button, Input, toast } from "@heroui/react";
import { SettingsContentCard } from "../_components/settings-content-card";

type Envelope<T> = { code: number; message: string; data: T | null };
type Settings = { retentionDays: number };

export default function RecycleBinSettingsPage() {
  const [days, setDays] = useState("7"); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  useEffect(() => { void (async () => { try { const response = await fetch("/api/settings/recycle-bin", { cache: "no-store" }); const body = await response.json() as Envelope<Settings>; if (!response.ok || !body.data) throw new Error(body.message); setDays(String(body.data.retentionDays)); } catch (e) { toast.danger("无法加载回收站设置", { description: e instanceof Error ? e.message : "请稍后重试" }); } finally { setLoading(false); } })(); }, []);
  async function save(event: React.FormEvent) { event.preventDefault(); const retentionDays = Number(days); if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) { toast.danger("请输入 1 至 3650 的整数天数"); return; } setSaving(true); try { const response = await fetch("/api/settings/recycle-bin", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ retentionDays }) }); const body = await response.json() as Envelope<Settings>; if (!response.ok || body.code !== 0) throw new Error(body.message); toast.success("回收站设置已保存"); } catch (e) { toast.danger("保存失败", { description: e instanceof Error ? e.message : "请稍后重试" }); } finally { setSaving(false); } }
  return <section className="h-full overflow-auto"><SettingsContentCard title="回收站设置" subtitle="配置删除数据在回收站中的最大保留时长。"><form className="max-w-md space-y-5" onSubmit={save}><label className="block text-sm font-medium">最大保留天数<Input className="mt-2" type="number" min="1" max="3650" value={days} disabled={loading} onChange={(event) => setDays(event.currentTarget.value)} /><span className="mt-1 block text-xs text-[var(--color-text-secondary)]">默认 7 天。超过保留期的数据将永久删除。</span></label><Button type="submit" isDisabled={loading || saving}>{saving ? "保存中…" : "保存设置"}</Button></form></SettingsContentCard></section>;
}
