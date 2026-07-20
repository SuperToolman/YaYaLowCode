"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input } from "@heroui/react";

type ApiEnvelope<T> = { code: number; message: string; data: T | null };
type OrganizationUnit = {
  id: string;
  sourceType: string;
  externalId: string;
  parentExternalId: string | null;
  name: string;
  status: string;
  memberCount: number;
};
type OrganizationNode = OrganizationUnit & { children: OrganizationNode[] };
type OrganizationSourceTree = { sourceType: string; roots: OrganizationNode[] };

export default function OrganizationSettingsPage() {
  const [units, setUnits] = useState<OrganizationUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadUnits = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/identity/organization-units", { cache: "no-store" });
      const payload = (await response.json()) as ApiEnvelope<OrganizationUnit[]>;
      if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(payload.message || "无法加载组织架构");
      setUnits(payload.data);
      setExpanded(new Set());
      setSelectedId((current) => current && payload.data!.some((unit) => unit.id === current) ? current : payload.data![0]?.id || null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载组织架构");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUnits(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUnits]);

  const tree = useMemo(() => buildOrganizationTree(units), [units]);
  const selected = units.find((unit) => unit.id === selectedId) || null;
  const selectedChildren = selected ? units.filter((unit) => unit.sourceType === selected.sourceType && unit.parentExternalId === selected.externalId).length : 0;
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");

  function toggleNode(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <section className="theme-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] shadow-[var(--shadow-card)]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">组织架构</h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{units.length} 个组织节点 · {units.reduce((total, unit) => total + unit.memberCount, 0)} 个部门成员关系</p>
        </div>
        <div className="flex items-center gap-2">
          <Input aria-label="搜索组织" className="w-56" placeholder="搜索部门名称" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          <Button variant="secondary" isDisabled={loading} onPress={() => void loadUnits()}>{loading ? "刷新中…" : "刷新"}</Button>
        </div>
      </div>

      {error ? <p className="mx-5 mt-4 rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">{error}</p> : null}

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex overflow-hidden">
          <div className="settings-scroll-area h-full min-h-0 min-w-0 flex-1 overflow-y-scroll border-r border-[var(--color-border)] p-3 overscroll-contain">
            <div className="space-y-3">
              {tree.map((source) => (
                <section key={source.sourceType} className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-control-soft)]">
                  <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <SourceTag source={source.sourceType} />
                      <span className="text-sm font-semibold text-[var(--color-text-primary)]">{sourceLabel(source.sourceType)}组织架构</span>
                    </div>
                    <span className="text-xs text-[var(--color-text-secondary)]">{countNodes(source.roots)} 个节点</span>
                  </div>
                  <div className="p-2">
                    {source.roots.map((node) => (
                      <TreeNode
                        key={node.id}
                        node={node}
                        depth={0}
                        expanded={expanded}
                        selectedId={selectedId}
                        query={normalizedQuery}
                        onToggle={toggleNode}
                        onSelect={setSelectedId}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
            {!loading && tree.length === 0 ? <div className="flex min-h-64 items-center justify-center text-sm text-[var(--color-text-secondary)]">暂无组织数据，请先在身份源设置中执行同步。</div> : null}
          </div>

          <div className="settings-scroll-area h-full min-h-0 w-[280px] shrink-0 overflow-y-scroll bg-[var(--color-control-soft)] p-5 overscroll-contain">
            {selected ? (
              <>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-primary-soft)] text-lg font-semibold text-[var(--color-primary)]">{selected.name.slice(0, 1)}</div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{selected.name}</h3>
                  <SourceTag source={selected.sourceType} />
                </div>
                <dl className="mt-6 space-y-4 text-sm">
                  <Detail label="状态" value={selected.status === "active" ? "启用" : "停用"} />
                  <Detail label="直属成员" value={`${selected.memberCount} 人`} />
                  <Detail label="直属子部门" value={`${selectedChildren} 个`} />
                  <Detail label="外部部门 ID" value={selected.externalId} />
                  <Detail label="上级部门 ID" value={selected.parentExternalId || "根节点"} />
                </dl>
              </>
            ) : <div className="text-sm text-[var(--color-text-secondary)]">选择一个组织节点查看详情。</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function TreeNode({ node, depth, expanded, selectedId, query, onToggle, onSelect }: { node: OrganizationNode; depth: number; expanded: Set<string>; selectedId: string | null; query: string; onToggle: (id: string) => void; onSelect: (id: string) => void }) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const matches = !query || node.name.toLocaleLowerCase("zh-CN").includes(query);
  const descendantMatches = node.children.some((child) => treeMatches(child, query));
  if (!matches && !descendantMatches) return null;

  return (
    <div className={depth > 0 ? "ml-5 border-l border-[var(--color-border)] pl-2" : ""}>
      <Button
        fullWidth
        variant="ghost"
        className={`group mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${selectedId === node.id ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"}`}
        onPress={() => { onSelect(node.id); if (hasChildren) onToggle(node.id); }}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-xs text-[var(--color-text-secondary)]">{hasChildren ? (isExpanded ? "▾" : "▸") : "•"}</span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--color-bg-surface)] text-xs font-semibold text-[var(--color-primary)] shadow-[var(--shadow-sm)]">{node.name.slice(0, 1)}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{node.name}</span>
        <SourceTag source={node.sourceType} />
        <span className="shrink-0 rounded-full bg-[var(--color-bg-surface)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]">{node.memberCount}</span>
      </Button>
      {hasChildren && (isExpanded || query) ? node.children.map((child) => <TreeNode key={child.id} node={child} depth={depth + 1} expanded={expanded} selectedId={selectedId} query={query} onToggle={onToggle} onSelect={onSelect} />) : null}
    </div>
  );
}

function buildOrganizationTree(units: OrganizationUnit[]): OrganizationSourceTree[] {
  const nodeMap = new Map(units.map((unit) => [`${unit.sourceType}:${unit.externalId}`, { ...unit, children: [] as OrganizationNode[] }]));
  const rootsBySource = new Map<string, OrganizationNode[]>();
  nodeMap.forEach((node) => {
    const parent = node.parentExternalId ? nodeMap.get(`${node.sourceType}:${node.parentExternalId}`) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      const roots = rootsBySource.get(node.sourceType) ?? [];
      roots.push(node);
      rootsBySource.set(node.sourceType, roots);
    }
  });
  const sort = (nodes: OrganizationNode[]) => nodes.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")).forEach((node) => sort(node.children));
  return [...rootsBySource.entries()]
    .map(([sourceType, roots]) => {
      sort(roots);
      return { sourceType, roots };
    })
    .sort((a, b) => sourceLabel(a.sourceType).localeCompare(sourceLabel(b.sourceType), "zh-CN"));
}

function treeMatches(node: OrganizationNode, query: string): boolean {
  return !query || node.name.toLocaleLowerCase("zh-CN").includes(query) || node.children.some((child) => treeMatches(child, query));
}

function countNodes(nodes: OrganizationNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

function sourceLabel(source: string): string {
  return source === "dingtalk" ? "钉钉" : "平台";
}

function SourceTag({ source }: { source: string }) { return source === "dingtalk" ? <span className="shrink-0 rounded-full bg-[#eaf2ff] px-2 py-0.5 text-[10px] font-semibold text-[#1677ff]">钉钉</span> : <span className="shrink-0 rounded-full bg-[var(--color-primary-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">平台</span>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-[var(--color-text-secondary)]">{label}</dt><dd className="mt-1 break-all font-medium text-[var(--color-text-primary)]">{value}</dd></div>; }
