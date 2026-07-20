"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Input,
  Radio,
  RadioGroup,
  Tabs,
} from "@heroui/react";
import { Tree, type NodeRendererProps } from "react-arborist";

type Envelope<T> = { code: number; message: string; data: T | null };
type Role = {
  id: string;
  name: string;
  sourceType: string;
  externalId: string;
  status: string;
  memberCount: number;
};
type App = { id: string; name: string; status: string };
type NavigationItem = {
  id: string;
  itemType: "group" | "form" | string;
  targetFormUuid: string | null;
  title: string;
  parentId: string | null;
};
type RolePermissions = { roleId: string; grants: string[] };
type Tab = "apps" | "platform";

const formActions = [
  "display",
  "create",
  "edit",
  "delete",
  "change_log",
  "comment",
  "import",
  "export",
  "bulk_edit",
  "bulk_delete",
  "batch_print",
  "create_view",
] as const;
const appActions = ["display", "edit"] as const;
const actionLabels: Record<string, string> = {
  display: "查看",
  create: "新增",
  edit: "编辑",
  delete: "删除",
  change_log: "变更记录",
  comment: "评论",
  import: "批量导入",
  export: "批量导出",
  bulk_edit: "批量修改",
  bulk_delete: "批量删除",
  batch_print: "批量打印",
  create_view: "创建视图",
};
const appActionLabels: Record<(typeof appActions)[number], string> = {
  display: "查看应用",
  edit: "编辑应用信息",
};
const formActionGroups = [
  ["常用操作", ["display", "create", "edit", "delete"]],
  ["详情页操作", ["change_log", "comment"]],
  [
    "视图与批量操作",
    [
      "import",
      "export",
      "bulk_edit",
      "bulk_delete",
      "batch_print",
      "create_view",
    ],
  ],
] as const;
const platformPermissions = [
  ["apps.manage", "应用管理", "创建和删除平台应用"],
  ["settings.database", "数据库连接", "管理 PostgreSQL 连接配置"],
  ["settings.agent", "Agent 配置", "管理模型提供商、Agent 与扩展能力"],
  ["settings.identity-source", "身份源配置", "管理平台账号与身份源"],
  ["settings.organization", "组织架构", "查看组织与部门结构"],
  ["settings.roles", "角色管理", "查看角色和成员绑定"],
  ["settings.users", "用户管理", "查看平台用户与状态"],
] as const;

export default function PermissionsSettingsPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [tree, setTree] = useState<Record<string, NavigationItem[]>>({});
  const [roleSearch, setRoleSearch] = useState("");
  const [roleId, setRoleId] = useState("");
  const [tab, setTab] = useState<Tab>("apps");
  const [selectedResource, setSelectedResource] = useState<{
    kind: "app" | "form";
    id: string;
    label: string;
  } | null>(null);
  const [grants, setGrants] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const activeRole = roles.find((role) => role.id === roleId);
  const isSystemAdministrator =
    activeRole?.externalId === "system-administrator";
  const filteredRoles = roles.filter((role) =>
    `${role.name} ${sourceLabel(role.sourceType)}`
      .toLowerCase()
      .includes(roleSearch.trim().toLowerCase()),
  );
  const grantSet = useMemo(() => new Set(grants), [grants]);
  const formAppIds = useMemo(
    () =>
      new Map(
        apps.flatMap((app) =>
          (tree[app.id] ?? [])
            .filter((item) => item.itemType === "form" && item.targetFormUuid)
            .map((item) => [item.targetFormUuid!, app.id] as const),
        ),
      ),
    [apps, tree],
  );

  const loadResources = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [rolesResponse, appsResponse] = await Promise.all([
        fetch("/api/identity/roles", { cache: "no-store" }),
        fetch("/api/apps", { cache: "no-store" }),
      ]);
      const rolesPayload = (await rolesResponse.json()) as Envelope<Role[]>;
      const appsPayload = (await appsResponse.json()) as Envelope<App[]>;
      if (!rolesResponse.ok || !rolesPayload.data)
        throw new Error(rolesPayload.message || "无法加载角色");
      if (!appsResponse.ok || !appsPayload.data)
        throw new Error(appsPayload.message || "无法加载应用");
      const nextRoles = rolesPayload.data.filter(
        (role) => role.status === "active",
      );
      const nextApps = appsPayload.data;
      setRoles(nextRoles);
      setApps(nextApps);
      const navigation = await Promise.all(
        nextApps.map(async (app) => {
          const response = await fetch(
            `/api/apps/${encodeURIComponent(app.id)}/navigation`,
            { cache: "no-store" },
          );
          const payload = (await response.json()) as Envelope<NavigationItem[]>;
          return [
            app.id,
            response.ok && payload.data ? payload.data : [],
          ] as const;
        }),
      );
      setTree(Object.fromEntries(navigation));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载权限资源");
    } finally {
      setLoading(false);
    }
  }, []);
  const loadPermissions = useCallback(async (nextRoleId: string) => {
    if (!nextRoleId) return;
    setError("");
    try {
      const response = await fetch(
        `/api/settings/permissions/${encodeURIComponent(nextRoleId)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as Envelope<RolePermissions>;
      if (!response.ok || !payload.data)
        throw new Error(payload.message || "无法加载角色权限");
      setGrants(payload.data.grants);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载角色权限");
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadResources(), 0);
    return () => window.clearTimeout(timer);
  }, [loadResources]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadPermissions(roleId), 0);
    return () => window.clearTimeout(timer);
  }, [loadPermissions, roleId]);

  function selectRole(id: string) {
    setRoleId(id);
    setSelectedResource(null);
    setMessage("");
  }
  function resourceState(prefix: string, actions: readonly string[]) {
    if (grantSet.has("*")) return "all";
    const count = actions.filter((action) =>
      grantSet.has(`${prefix}:${action}`),
    ).length;
    return count === actions.length ? "all" : count ? "partial" : "none";
  }
  function setAll(
    prefix: string,
    actions: readonly string[],
    checked: boolean,
  ) {
    if (isSystemAdministrator) return;
    setGrants((current) => {
      const without = current.filter(
        (grant) => !actions.some((action) => grant === `${prefix}:${action}`),
      );
      return checked
        ? [
            ...without,
            ...actions.map((action) => `${prefix}:${action}`),
            ...(prefix.startsWith("form:") && formAppIds.get(prefix.slice(5))
              ? [`app:${formAppIds.get(prefix.slice(5))}:display`]
              : []),
          ]
        : without;
    });
  }
  function setFormsAll(appId: string, formIds: string[], checked: boolean) {
    if (isSystemAdministrator || !formIds.length) return;
    const formGrants = formIds.flatMap((formId) =>
      formActions.map((action) => `form:${formId}:${action}`),
    );
    setGrants((current) => {
      const without = current.filter((grant) => !formGrants.includes(grant));
      return checked ? [...without, ...formGrants, `app:${appId}:display`] : without;
    });
  }
  function toggle(grant: string) {
    if (!isSystemAdministrator)
      setGrants((current) =>
        current.includes(grant)
          ? current.filter((item) => item !== grant)
          : [
              ...current,
              grant,
              ...(grant.startsWith("form:") && formAppIds.get(grant.split(":")[1])
                ? [`app:${formAppIds.get(grant.split(":")[1])}:display`]
                : []),
            ],
      );
  }
  function setScope(
    prefix: string,
    kind: "data_scope" | "view_scope",
    value: string,
  ) {
    if (!isSystemAdministrator)
      setGrants((current) => [
        ...current.filter((grant) => !grant.startsWith(`${prefix}:${kind}:`)),
        `${prefix}:${kind}:${value}`,
      ]);
  }
  function setVisibleViews(prefix: string, viewIds: string[]) {
    if (!isSystemAdministrator)
      setGrants((current) => [
        ...current.filter((grant) => !grant.startsWith(`${prefix}:view:`)),
        ...viewIds.map((viewId) => `${prefix}:view:${viewId}`),
      ]);
  }
  async function save() {
    if (!roleId) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/settings/permissions/${encodeURIComponent(roleId)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ grants }),
        },
      );
      const payload = (await response.json()) as Envelope<RolePermissions>;
      if (!response.ok || !payload.data)
        throw new Error(payload.message || "保存权限失败");
      setGrants(payload.data.grants);
      setMessage("权限配置已保存");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存权限失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] gap-4">
      <aside className="theme-panel flex min-h-0 flex-col overflow-hidden rounded-[22px] p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          授权角色
        </h2>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
          搜索并选择需要配置的角色
        </p>
        <Input
          aria-label="搜索角色"
          className="mt-4"
          fullWidth
          placeholder="搜索角色名称或来源"
          value={roleSearch}
          onChange={(event) => setRoleSearch(event.currentTarget.value)}
        />
        <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
          {filteredRoles.map((role) => (
            <Button
              key={role.id}
              fullWidth
              variant="ghost"
              onPress={() => selectRole(role.id)}
              className={`h-auto justify-start rounded-xl px-3 py-3 text-left ${role.id === roleId ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "text-[var(--color-text-primary)]"}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {role.name}
                </span>
                <span className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
                  <SourceTag source={role.sourceType} />
                  <span>{role.memberCount} 名成员</span>
                </span>
              </span>
            </Button>
          ))}
          {!loading && !filteredRoles.length ? (
            <p className="px-2 py-6 text-center text-sm text-[var(--color-text-secondary)]">
              未找到匹配角色
            </p>
          ) : null}
        </div>
      </aside>
      <div className="theme-panel flex min-h-0 flex-col overflow-hidden rounded-[22px] shadow-[var(--shadow-card)]">
        <header className="shrink-0 border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
                权限设置
              </h1>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                {activeRole
                  ? isSystemAdministrator
                    ? "系统管理员拥有全部权限，权限不可修改"
                    : `正在配置「${activeRole.name}」的 RBAC 权限`
                  : "请先从左侧选择授权角色"}
              </p>
            </div>
            <Button
              variant="primary"
              isDisabled={!roleId || saving || isSystemAdministrator}
              onPress={() => void save()}
            >
              {saving ? "正在保存…" : "保存权限"}
            </Button>
          </div>
          {activeRole ? (
            <Tabs
              variant="secondary"
              selectedKey={tab}
              onSelectionChange={(key) => setTab(key as Tab)}
              className="mt-4"
            >
              <Tabs.List aria-label="权限类型">
                <Tabs.Tab id="apps">
                  应用权限
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="platform">
                  平台权限
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
          ) : null}
        </header>
        {error ? (
          <p className="mx-5 mt-4 rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mx-5 mt-4 rounded-xl bg-[var(--color-success-soft)] px-4 py-3 text-sm text-[var(--color-success)]">
            {message}
          </p>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {!activeRole ? (
            <Empty text="选择角色后可设置应用权限和平台权限。" />
          ) : tab === "apps" ? (
            <div className="grid min-h-[460px] grid-cols-[minmax(260px,0.9fr)_minmax(0,1.4fr)] overflow-hidden rounded-2xl border border-[var(--color-border)]">
              <AppTree
                apps={apps}
                tree={tree}
                state={resourceState}
                onSelect={setSelectedResource}
                onSetAll={setAll}
                onSetFormsAll={setFormsAll}
                selected={selectedResource}
              />
              <ResourcePermissions
                resource={selectedResource}
                grants={grantSet}
                state={resourceState}
                onToggle={toggle}
                onSetScope={setScope}
                onSetVisibleViews={setVisibleViews}
              />
            </div>
          ) : (
            <PlatformPermissions grants={grantSet} onToggle={toggle} />
          )}
        </div>
      </div>
    </section>
  );
}

type PermissionTreeNode = {
  id: string;
  name: string;
  kind: "app" | "group" | "form";
  resourceId?: string;
  appId?: string;
  children?: PermissionTreeNode[];
};
function AppTree({
  apps,
  tree,
  state,
  onSelect,
  onSetAll,
  onSetFormsAll,
  selected,
}: {
  apps: App[];
  tree: Record<string, NavigationItem[]>;
  state: (
    prefix: string,
    actions: readonly string[],
  ) => "all" | "partial" | "none";
  onSelect: (value: {
    kind: "app" | "form";
    id: string;
    label: string;
  }) => void;
  onSetAll: (
    prefix: string,
    actions: readonly string[],
    checked: boolean,
  ) => void;
  onSetFormsAll: (appId: string, formIds: string[], checked: boolean) => void;
  selected: { kind: "app" | "form"; id: string } | null;
}) {
  const data = useMemo<PermissionTreeNode[]>(
    () =>
      apps.map((app) => ({
        id: `app:${app.id}`,
        name: app.name,
        kind: "app",
        resourceId: app.id,
        children: buildChildren(tree[app.id] ?? [], null, app.id),
      })),
    [apps, tree],
  );
  return (
    <aside className="border-r border-[var(--color-border)] bg-[var(--color-control-soft)] p-3">
      <p className="px-2 pb-3 text-xs font-semibold text-[var(--color-text-secondary)]">
        应用结构
      </p>
      {data.length ? (
        <Tree
          data={data}
          width="100%"
          height={480}
          indent={20}
          rowHeight={44}
          openByDefault
          disableDrag
          disableDrop
        >
          {({ node, style }: NodeRendererProps<PermissionTreeNode>) => {
            const item = node.data;
            const prefix =
              item.kind === "app"
                ? `app:${item.resourceId}`
                : item.kind === "form"
                  ? `form:${item.resourceId}`
                  : "";
            const actions = item.kind === "app" ? appActions : formActions;
            const groupFormIds =
              item.kind === "group" ? findDescendantFormIds(item) : [];
            const groupStates = groupFormIds.map((formId) =>
              state(`form:${formId}`, formActions),
            );
            const status = prefix
              ? state(prefix, actions)
              : groupStates.length &&
                  groupStates.every((value) => value === "all")
                ? "all"
                : groupStates.some((value) => value !== "none")
                  ? "partial"
                  : "none";
            const active =
              (item.kind === "app" || item.kind === "form") &&
              selected?.kind === item.kind &&
              selected.id === item.resourceId;
            return (
              <div style={style} className="px-1">
                <div
                  className={`flex h-[38px] items-center gap-1.5 rounded-lg px-2 ${active ? "bg-[var(--color-primary-soft)]" : "hover:bg-[var(--color-bg-hover)]"}`}
                >
                  {node.isInternal ? (
                    <button
                      type="button"
                      aria-label={node.isOpen ? "收起" : "展开"}
                      onClick={() => node.toggle()}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
                    >
                      <span
                        className={`text-xl leading-none transition-transform ${node.isOpen ? "rotate-90" : ""}`}
                      >
                        ›
                      </span>
                    </button>
                  ) : (
                    <span aria-hidden className="h-6 w-6 shrink-0" />
                  )}
                  {item.kind === "group" ? (
                    <PermissionCheckbox
                      label={`授予分组${item.name}下所有表单全部权限`}
                      state={status}
                      isDisabled={!groupFormIds.length}
                      onChange={(checked) =>
                        onSetFormsAll(item.appId!, groupFormIds, checked)
                      }
                    />
                  ) : (
                    <PermissionCheckbox
                      label={`授予${item.name}全部权限`}
                      state={status}
                      onChange={(checked) => onSetAll(prefix, actions, checked)}
                    />
                  )}
                  <button
                    type="button"
                    disabled={item.kind === "group"}
                    onClick={() =>
                      item.kind !== "group" &&
                      onSelect({
                        kind: item.kind,
                        id: item.resourceId!,
                        label: item.name,
                      })
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm disabled:cursor-default"
                  >
                    <TreeIcon kind={item.kind} />
                    <span className="truncate text-[var(--color-text-primary)]">
                      {item.name}
                    </span>
                  </button>
                  <StatusTag
                    value={
                      status === "all"
                        ? "全部"
                        : status === "partial"
                          ? "部分"
                          : "未授权"
                    }
                    tone={status}
                  />
                </div>
              </div>
            );
          }}
        </Tree>
      ) : (
        <Empty text="暂无应用" />
      )}
    </aside>
  );
}
function findDescendantFormIds(node: PermissionTreeNode): string[] {
  return (node.children ?? []).flatMap((child) =>
    child.kind === "form" && child.resourceId
      ? [child.resourceId]
      : findDescendantFormIds(child),
  );
}
function buildChildren(
  items: NavigationItem[],
  parentId: string | null,
  appId: string,
): PermissionTreeNode[] {
  return items
    .filter(
      (item) =>
        item.parentId === parentId &&
        (item.itemType === "group" || item.itemType === "form"),
    )
    .flatMap<PermissionTreeNode>((item): PermissionTreeNode[] =>
      item.itemType === "group"
        ? [
            {
              id: `group:${item.id}`,
              name: item.title,
              kind: "group",
              appId,
              children: buildChildren(items, item.id, appId),
            },
          ]
        : item.targetFormUuid
          ? [
              {
                id: `form:${item.targetFormUuid}`,
              name: item.title,
              kind: "form",
              resourceId: item.targetFormUuid,
              appId,
              },
            ]
          : [],
    );
}
function TreeIcon({ kind }: { kind: "app" | "group" | "form" }) {
  return kind === "app" ? (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0 text-[var(--color-primary)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 7.5h8M8 11.5h8M8 15.5h5" />
    </svg>
  ) : kind === "group" ? (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0 text-[var(--color-warning)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M3.5 7.5h6l1.7 2h9.3v8.7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0 text-[var(--color-text-secondary)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4M9 12h6M9 16h6" />
    </svg>
  );
}
function ResourcePermissions({
  resource,
  grants,
  state,
  onToggle,
  onSetScope,
  onSetVisibleViews,
}: {
  resource: { kind: "app" | "form"; id: string; label: string } | null;
  grants: Set<string>;
  state: (
    prefix: string,
    actions: readonly string[],
  ) => "all" | "partial" | "none";
  onToggle: (grant: string) => void;
  onSetScope: (
    prefix: string,
    kind: "data_scope" | "view_scope",
    value: string,
  ) => void;
  onSetVisibleViews: (prefix: string, viewIds: string[]) => void;
}) {
  if (!resource)
    return (
      <div className="flex items-center justify-center p-8">
        <Empty text="从左侧选择应用或表单后配置具体权限。" />
      </div>
    );
  const actions = resource.kind === "app" ? appActions : formActions;
  const prefix = `${resource.kind}:${resource.id}`;
  const locked = grants.has("*");
  function selected(action: string) {
    return locked || grants.has(`${prefix}:${action}`);
  }
  function selectScope(kind: "data_scope" | "view_scope", value: string) {
    if (!locked) onSetScope(prefix, kind, value);
  }
  return (
    <section className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {resource.kind === "app" ? "应用" : "表单"}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
            {resource.label}
          </h2>
        </div>
        <StatusTag
          value={
            state(prefix, actions) === "all"
              ? "已授予全部权限"
              : state(prefix, actions) === "partial"
                ? "已授予部分权限"
                : "未授予权限"
          }
          tone={state(prefix, actions)}
        />
      </div>
      {resource.kind === "app" ? (
        <PermissionPanel title="应用操作权限">
          <OperationChecks
            actions={appActions}
            prefix={prefix}
            selected={selected}
            locked={locked}
            onToggle={onToggle}
            labels={appActionLabels}
          />
        </PermissionPanel>
      ) : (
        <>
          <PermissionPanel title="操作权限">
            {formActionGroups.map(([title, groupActions]) => (
              <div
                key={title}
                className="grid grid-cols-[132px_minmax(0,1fr)] items-start gap-4 border-b border-[var(--color-border)] py-3 last:border-b-0"
              >
                <span className="pt-1 text-sm whitespace-nowrap text-[var(--color-text-secondary)]">
                  {title}
                </span>
                <OperationChecks
                  actions={groupActions}
                  prefix={prefix}
                  selected={selected}
                  locked={locked}
                  onToggle={onToggle}
                />
              </div>
            ))}
          </PermissionPanel>
          <ScopePanel
            title="数据范围"
            description="限定此角色在该表单可访问的数据记录。"
            prefix={prefix}
            kind="data_scope"
            grants={grants}
            locked={locked}
            onSelect={selectScope}
            options={[
              ["all", "全部数据"],
              ["self", "本人提交"],
              ["department", "本部门提交"],
              ["sub_department", "下级部门提交"],
              ["none", "无数据权限"],
            ]}
          />
          <ViewScopePanel
            prefix={prefix}
            formId={resource.id}
            grants={grants}
            locked={locked}
            onSelectScope={selectScope}
            onSetViews={onSetVisibleViews}
          />
        </>
      )}
    </section>
  );
}
function PermissionPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}
function OperationChecks({
  actions,
  prefix,
  selected,
  locked,
  onToggle,
  labels = actionLabels,
}: {
  actions: readonly string[];
  prefix: string;
  selected: (action: string) => boolean;
  locked: boolean;
  onToggle: (grant: string) => void;
  labels?: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {actions.map((action) => (
        <Checkbox
          key={`${prefix}:${action}`}
          isSelected={selected(action)}
          isDisabled={locked}
          onChange={() => onToggle(`${prefix}:${action}`)}
        >
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Checkbox.Content className="text-sm">
            {labels[action] ?? action}
          </Checkbox.Content>
        </Checkbox>
      ))}
    </div>
  );
}
function ScopePanel({
  title,
  description,
  prefix,
  kind,
  grants,
  locked,
  onSelect,
  options,
}: {
  title: string;
  description: string;
  prefix: string;
  kind: "data_scope" | "view_scope";
  grants: Set<string>;
  locked: boolean;
  onSelect: (kind: "data_scope" | "view_scope", value: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  const selected =
    options.find(([value]) => grants.has(`${prefix}:${kind}:${value}`))?.[0] ??
    "all";
  return (
    <PermissionPanel title={title}>
      <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
        {description}
      </p>
      <RadioGroup
        aria-label={title}
        value={selected}
        isDisabled={locked}
        onChange={(value) => onSelect(kind, value)}
        className="flex flex-wrap gap-x-5 gap-y-2"
      >
        {options.map(([value, label]) => (
          <Radio key={value} value={value}>
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            <Radio.Content className="text-sm">{label}</Radio.Content>
          </Radio>
        ))}
      </RadioGroup>
    </PermissionPanel>
  );
}
function ViewScopePanel({
  prefix,
  formId,
  grants,
  locked,
  onSelectScope,
  onSetViews,
}: {
  prefix: string;
  formId: string;
  grants: Set<string>;
  locked: boolean;
  onSelectScope: (kind: "data_scope" | "view_scope", value: string) => void;
  onSetViews: (prefix: string, viewIds: string[]) => void;
}) {
  const [views, setViews] = useState<Array<{ id: string; name: string }>>([
    { id: "default", name: "全部视图（默认视图）" },
  ]);
  const scope = grants.has(`${prefix}:view_scope:specified`)
    ? "specified"
    : "all";
  const selectedViews = [...grants]
    .filter((grant) => grant.startsWith(`${prefix}:view:`))
    .map((grant) => grant.slice(`${prefix}:view:`.length));
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch(`/api/forms/${encodeURIComponent(formId)}/views`, {
        cache: "no-store",
      }).then(async (response) => {
        const payload = (await response.json()) as {
          data: Array<{ viewUuid: string; name: string }> | null;
        };
        if (response.ok && payload.data)
          setViews([
            { id: "default", name: "全部视图（默认视图）" },
            ...payload.data.map((view) => ({
              id: view.viewUuid,
              name: view.name,
            })),
          ]);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [formId]);
  return (
    <PermissionPanel title="可见视图">
      <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
        控制该角色可访问的表单视图范围。
      </p>
      <RadioGroup
        aria-label="可见视图范围"
        value={scope}
        isDisabled={locked}
        onChange={(value) => onSelectScope("view_scope", value)}
        className="flex gap-5"
      >
        <Radio value="all">
          <Radio.Control>
            <Radio.Indicator />
          </Radio.Control>
          <Radio.Content className="text-sm">全部视图</Radio.Content>
        </Radio>
        <Radio value="specified">
          <Radio.Control>
            <Radio.Indicator />
          </Radio.Control>
          <Radio.Content className="text-sm">指定视图</Radio.Content>
        </Radio>
      </RadioGroup>
      {scope === "specified" ? (
        <CheckboxGroup
          aria-label="指定可见视图"
          value={selectedViews}
          isDisabled={locked}
          onChange={(values) => onSetViews(prefix, values)}
          className="mt-4 grid gap-2 sm:grid-cols-2"
        >
          {views.map((view) => (
            <Checkbox
              key={view.id}
              value={view.id}
              className="rounded-xl border border-[var(--color-border)] px-3 py-2"
            >
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Checkbox.Content className="text-sm">
                {view.name}
              </Checkbox.Content>
            </Checkbox>
          ))}
        </CheckboxGroup>
      ) : null}
    </PermissionPanel>
  );
}
function PlatformPermissions({
  grants,
  onToggle,
}: {
  grants: Set<string>;
  onToggle: (grant: string) => void;
}) {
  const locked = grants.has("*");
  return (
    <section className="mx-auto max-w-3xl">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
        平台权限
      </h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        控制设置中心及其细分页面的访问范围。
      </p>
      <div className="mt-5 space-y-3">
        {platformPermissions.map(([key, label, description]) => {
          const granted = locked || grants.has(`platform:${key}`);
          return (
            <Checkbox
              key={key}
              isSelected={granted}
              isDisabled={locked}
              onChange={() => onToggle(`platform:${key}`)}
              className="flex items-start justify-between rounded-2xl border border-[var(--color-border)] p-4"
            >
              <span className="flex items-start gap-3">
                <Checkbox.Control className="mt-0.5">
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Content>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">
                    {description}
                  </span>
                </Checkbox.Content>
              </span>
              <StatusTag
                value={granted ? "已授权" : "未授权"}
                tone={granted ? "all" : "none"}
              />
            </Checkbox>
          );
        })}
      </div>
    </section>
  );
}
function PermissionCheckbox({
  label,
  state,
  isDisabled = false,
  onChange,
}: {
  label: string;
  state: "all" | "partial" | "none";
  isDisabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = state === "partial";
  }, [state]);
  return (
    <input
      ref={inputRef}
      aria-label={label}
      type="checkbox"
      checked={state === "all"}
      disabled={isDisabled}
      onChange={(event) => onChange(event.currentTarget.checked)}
      className="h-4 w-4 accent-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}
function SourceTag({ source }: { source: string }) {
  const isDingTalk = source === "dingtalk";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${isDingTalk ? "border-[#b7d4ff] bg-[#eaf2ff] text-[#1677ff]" : "border-[#d9d9d9] bg-[#f5f5f5] text-[#595959]"}`}
    >
      {sourceLabel(source)}
    </span>
  );
}
function StatusTag({
  value,
  tone,
}: {
  value: string;
  tone: "all" | "partial" | "none" | "neutral";
}) {
  const toneClass =
    tone === "all"
      ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
      : tone === "partial"
        ? "bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
        : tone === "none"
          ? "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"
          : "bg-[var(--color-primary-soft)] text-[var(--color-primary)]";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${toneClass}`}
    >
      {value}
    </span>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <p className="text-center text-sm text-[var(--color-text-secondary)]">
      {text}
    </p>
  );
}
function sourceLabel(source: string) {
  return source === "dingtalk" ? "钉钉" : source === "local" ? "平台" : source;
}
