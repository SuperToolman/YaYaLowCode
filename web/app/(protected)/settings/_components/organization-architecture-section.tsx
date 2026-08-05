"use client";

import { useCallback, useEffect, useMemo, useState, type Key } from "react";
import { Avatar, Button, Input, ListBox, Modal, Select } from "@heroui/react";
import { listOrganizationUnits, listUsers } from "@/features/identity-access/api";
import type { ApiEnvelope } from "@/app/lib/api-request";

type OrganizationMember = { id: string; displayName: string; avatarUrl: string | null; title: string | null; status: string };
type OrganizationUnit = { id: string; sourceType: string; externalId: string; parentExternalId: string | null; name: string; status: string; memberCount: number; members?: OrganizationMember[] };
type OrganizationUser = OrganizationMember & { sourceType: string; departments: string[] };
type OrganizationNode = OrganizationUnit & { children: OrganizationNode[] };

export function OrganizationArchitectureSection({ sourceType, sourceLabel }: { sourceType: string; sourceLabel: string }) {
  const canCreate = sourceType === "local";
  const [units, setUnits] = useState<OrganizationUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [parentExternalId, setParentExternalId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [unitsResult, usersResult] = await Promise.all([listOrganizationUnits({ responseStyle: "fields" }), listUsers({ responseStyle: "fields" })]);
      const unitsPayload = unitsResult.data as ApiEnvelope<OrganizationUnit[]> | undefined;
      if (unitsResult.error || unitsPayload?.code !== 0 || !unitsPayload.data) throw new Error(unitsPayload?.message || "无法加载组织架构");
      const usersPayload = usersResult.error ? null : usersResult.data as ApiEnvelope<OrganizationUser[]> | undefined;
      const membersByDepartment = new Map<string, OrganizationMember[]>();
      for (const user of usersPayload?.data ?? []) for (const department of user.departments ?? []) {
        const key = `${user.sourceType}:${department}`;
        membersByDepartment.set(key, [...(membersByDepartment.get(key) ?? []), user]);
      }
      const next = unitsPayload.data.filter((unit) => unit.sourceType === sourceType).map((unit) => ({ ...unit, members: unit.members ?? membersByDepartment.get(`${unit.sourceType}:${unit.name}`) ?? [] }));
      setUnits(next);
      setSelectedId((current) => current && next.some((unit) => unit.id === current) ? current : next[0]?.id ?? null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法加载组织架构"); }
    finally { setLoading(false); }
  }, [sourceType]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const tree = useMemo(() => buildTree(units), [units]);
  const selected = units.find((unit) => unit.id === selectedId) ?? null;
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const selectedChildren = selected ? units.filter((unit) => unit.parentExternalId === selected.externalId).length : 0;

  function openCreate() { setOrganizationName(""); setParentExternalId(selected?.externalId ?? null); setCreateOpen(true); }
  async function createOrganization() {
    const name = organizationName.trim(); if (!name) { setError("请填写组织名称"); return; }
    setCreating(true); setError("");
    try {
      const response = await fetch("/api/identity/organization-units", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, parentExternalId }) });
      const payload = await response.json() as ApiEnvelope<OrganizationUnit>;
      if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(payload.message || "创建组织失败");
      setCreateOpen(false);
      await load();
      setSelectedId(payload.data.id);
      if (parentExternalId) {
        const parent = units.find((unit) => unit.externalId === parentExternalId);
        if (parent) setExpanded((current) => new Set(current).add(parent.id));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "创建组织失败"); }
    finally { setCreating(false); }
  }

  return <section className="border-t border-[var(--color-border)] pt-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{sourceLabel}组织架构</h3><p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{units.length} 个组织节点，{units.reduce((total, unit) => total + unit.memberCount, 0)} 个直属成员关系。</p></div><div className="flex flex-wrap gap-2"><Input aria-label={`搜索${sourceLabel}组织`} className="w-52" placeholder="搜索部门或成员" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />{canCreate ? <Button onPress={openCreate}>新建组织</Button> : null}<Button variant="secondary" isDisabled={loading} onPress={() => void load()}>{loading ? "刷新中…" : "刷新"}</Button></div></div>
    {error ? <p className="mt-4 rounded-md bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{error}</p> : null}
    <div className="mt-4 grid min-h-[360px] overflow-hidden border border-[var(--color-border)] md:grid-cols-[minmax(0,1fr)_280px]"><div className="max-h-[520px] overflow-y-auto p-3">{tree.map((node) => <OrganizationTreeNode key={node.id} node={node} depth={0} expanded={expanded} selectedId={selectedId} query={normalizedQuery} onSelect={setSelectedId} onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} />)}{!loading && !tree.length ? <p className="grid min-h-44 place-items-center text-sm text-[var(--color-text-secondary)]">暂无组织数据。</p> : null}</div><aside className="border-t border-[var(--color-border)] bg-[var(--color-control-soft)] p-4 md:border-l md:border-t-0">{selected ? <><div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary)]">{selected.name.slice(0, 1)}</div><h4 className="mt-3 text-sm font-semibold text-[var(--color-text-primary)]">{selected.name}</h4><dl className="mt-4 space-y-3 text-xs"><OrganizationDetail label="状态" value={selected.status === "active" ? "启用" : "停用"} /><OrganizationDetail label="直属成员" value={`${selected.memberCount} 人`} /><OrganizationDetail label="直属子部门" value={`${selectedChildren} 个`} /><OrganizationDetail label="组织 ID" value={selected.externalId} /></dl><div className="mt-4 border-t border-[var(--color-border)] pt-3"><p className="text-xs font-semibold text-[var(--color-text-secondary)]">直属成员</p>{selected.members?.length ? <div className="mt-2 space-y-2">{selected.members.map((member) => <div key={member.id} className="flex min-w-0 items-center gap-2"><Avatar className="h-7 w-7 shrink-0"><Avatar.Image alt="" src={member.avatarUrl ?? undefined} /><Avatar.Fallback>{member.displayName.slice(0, 1)}</Avatar.Fallback></Avatar><span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-primary)]">{member.displayName}</span></div>)}</div> : <p className="mt-2 text-xs text-[var(--color-text-secondary)]">暂无直属成员。</p>}</div></> : <p className="text-sm text-[var(--color-text-secondary)]">选择组织节点查看详情。</p>}</aside></div>
    <Modal isOpen={createOpen} onOpenChange={(open) => !creating && setCreateOpen(open)}><Modal.Backdrop className="theme-modal-backdrop" isDismissable={!creating}><Modal.Container placement="center" size="sm"><Modal.Dialog className="rounded-2xl bg-[var(--color-bg-surface)]"><Modal.Header><Modal.Heading>新建组织</Modal.Heading><Modal.CloseTrigger aria-label="关闭" isDisabled={creating} /></Modal.Header><Modal.Body className="space-y-4"><Input autoFocus aria-label="组织名" placeholder="组织名" value={organizationName} disabled={creating} onChange={(event) => setOrganizationName(event.currentTarget.value)} /><Select aria-label="上级组织" fullWidth selectedKey={parentExternalId ?? "__root__"} isDisabled={creating} onSelectionChange={(key: Key | null) => setParentExternalId(key === null || key === "__root__" ? null : String(key))}><Select.Trigger><Select.Value>{parentExternalId ? units.find((unit) => unit.externalId === parentExternalId)?.name ?? "请选择上级组织" : "根级组织"}</Select.Value><Select.Indicator /></Select.Trigger><Select.Popover><ListBox><ListBox.Item id="__root__" textValue="根级组织">根级组织</ListBox.Item>{units.map((unit) => <ListBox.Item key={unit.externalId} id={unit.externalId} textValue={unit.name}>{unit.name}</ListBox.Item>)}</ListBox></Select.Popover></Select></Modal.Body><Modal.Footer><Button variant="ghost" isDisabled={creating} onPress={() => setCreateOpen(false)}>取消</Button><Button isDisabled={creating} onPress={() => void createOrganization()}>{creating ? "正在创建…" : "创建组织"}</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
  </section>;
}

function OrganizationTreeNode({ node, depth, expanded, selectedId, query, onSelect, onToggle }: { node: OrganizationNode; depth: number; expanded: Set<string>; selectedId: string | null; query: string; onSelect: (id: string) => void; onToggle: (id: string) => void }) {
  const matches = nodeMatches(node, query); if (!matches) return null;
  const hasChildren = node.children.length > 0; const open = expanded.has(node.id) || Boolean(query);
  return <div className={depth ? "ml-4 border-l border-[var(--color-border)] pl-2" : ""}><div className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm ${selectedId === node.id ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"}`}>{hasChildren ? <button type="button" aria-label={`${open ? "收起" : "展开"}${node.name}`} className="grid h-5 w-5 place-items-center" onClick={() => onToggle(node.id)}>{open ? "▾" : "▸"}</button> : <span className="grid h-5 w-5 place-items-center text-xs">•</span>}<button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(node.id)}>{node.name}</button><span className="text-xs text-[var(--color-text-secondary)]">{node.memberCount}</span></div>{hasChildren && open ? node.children.map((child) => <OrganizationTreeNode key={child.id} node={child} depth={depth + 1} expanded={expanded} selectedId={selectedId} query={query} onSelect={onSelect} onToggle={onToggle} />) : null}</div>;
}

function nodeMatches(node: OrganizationNode, query: string): boolean { return !query || node.name.toLocaleLowerCase("zh-CN").includes(query) || (node.members ?? []).some((member) => member.displayName.toLocaleLowerCase("zh-CN").includes(query)) || node.children.some((child) => nodeMatches(child, query)); }
function OrganizationDetail({ label, value }: { label: string; value: string }) { return <div><dt className="text-[var(--color-text-secondary)]">{label}</dt><dd className="mt-1 break-all font-medium text-[var(--color-text-primary)]">{value}</dd></div>; }
function buildTree(units: OrganizationUnit[]) { const nodes = new Map(units.map((unit) => [`${unit.sourceType}:${unit.externalId}`, { ...unit, children: [] as OrganizationNode[] }])); const roots: OrganizationNode[] = []; nodes.forEach((node) => { const parent = node.parentExternalId ? nodes.get(`${node.sourceType}:${node.parentExternalId}`) : null; if (parent) parent.children.push(node); else roots.push(node); }); const sort = (items: OrganizationNode[]) => items.sort((left, right) => left.name.localeCompare(right.name, "zh-CN")).forEach((item) => sort(item.children)); sort(roots); return roots; }
