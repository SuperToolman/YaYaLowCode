"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  getRolePermissions,
  listAppNavigation,
  listApps,
  listRoles,
  updateRolePermissions,
} from "../../lib/api-client";
import { mapWithConcurrency } from "../../lib/async";
import { SettingsContentCard } from "../_components/settings-content-card";

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
type Tab = "apps" | "platform";
type RoleSourceFilter = "all" | "local" | "dingtalk";

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
const appActions = [
  "display",
  "edit_info",
  "create_group",
  "automation",
  "settings",
  "publish",
  "create_form",
  "edit_form",
  "delete_form",
  "view_development",
] as const;
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
  edit_info: "编辑应用信息",
  create_group: "创建分组",
  automation: "集成自动化",
  settings: "应用设置",
  publish: "应用发布",
  create_form: "创建表单",
  edit_form: "编辑表单",
  delete_form: "删除表单",
  view_development: "全部表单视图操作",
};
const applicationDevelopmentActions = ["edit_info", "create_group", "automation", "settings", "publish"] as const;
const formDevelopmentActions = ["create_form", "edit_form", "delete_form"] as const;
const formActionGroups = [
  ["常用操作", ["display", "create", "edit", "delete"]],
  ["详情页操作", ["change_log", "comment"]],
] as const;
const platformPermissionGroups = [
  {
    key: "apps",
    label: "应用",
    description: "平台应用工作台及管理入口",
    items: [
      ["apps.access", "访问应用", "进入应用工作台并查看已授权应用"],
      ["apps.manage", "应用管理", "创建和删除平台应用"],
      ["apps.import", "应用导入", "从导入文件创建平台应用"],
    ],
  },
  {
    key: "agent-window",
    label: "Agent 服务窗口",
    description: "打开 YaYa Agent 并发起服务会话",
    items: [["agent.window", "访问服务窗口", "查看 Agent 会话并发送消息"]],
  },
  {
    key: "designer",
    label: "大纲",
    description: "查看应用的表单与字段大纲",
    items: [["designer.access", "访问大纲", "查看应用下的表单和字段结构"]],
  },
  {
    key: "settings",
    label: "设置",
    description: "设置中心及其页面的访问入口",
    items: [
      ["settings.database", "数据库连接", "管理 PostgreSQL 连接配置"],
      ["settings.agent", "Agent 配置", "管理模型提供商、Agent 与扩展能力"],
      ["settings.identity-source", "身份源配置", "管理平台账号与身份源"],
      ["settings.organization", "组织架构", "查看组织与部门结构"],
      ["settings.roles", "角色管理", "查看角色和成员绑定"],
      ["settings.users", "用户管理", "查看平台用户与状态"],
    ],
  },
] as const;

export default function PermissionsSettingsPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [tree, setTree] = useState<Record<string, NavigationItem[]>>({});
  const [roleSearch, setRoleSearch] = useState("");
  const [roleSourceFilter, setRoleSourceFilter] = useState<RoleSourceFilter>("all");
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
    (roleSourceFilter === "all" || role.sourceType === roleSourceFilter) &&
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
      const [rolesResult, appsResult] = await Promise.all([
        listRoles({ responseStyle: "fields" }),
        listApps({ responseStyle: "fields" }),
      ]);
      const rolesData = rolesResult.data;
      const appsData = appsResult.data;
      if (
        rolesResult.error ||
        !rolesData ||
        rolesData.code !== 0 ||
        !rolesData.data ||
        appsResult.error ||
        !appsData ||
        appsData.code !== 0 ||
        !appsData.data
      ) {
        throw new Error("无法加载权限资源");
      }
      const nextRoles = rolesData.data.filter(
        (role) => role.status === "active",
      );
      const nextApps = appsData.data;
      setRoles(nextRoles);
      setApps(nextApps);
      const navigation = await mapWithConcurrency(nextApps, 6, async (app) => {
          try {
            const { data, error } = await listAppNavigation({
              path: { appId: app.id },
              responseStyle: "fields",
            });
            if (error || !data || data.code !== 0 || !data.data) {
              return [app.id, []] as const;
            }
            const items = data.data.map((item) => ({
              ...item,
              parentId: item.parentId ?? null,
              targetFormUuid: item.targetFormUuid ?? null,
            }));
            return [app.id, items] as const;
          } catch {
            return [app.id, []] as const;
          }
        });
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
      const { data, error } = await getRolePermissions({
        path: { roleId: nextRoleId },
        responseStyle: "fields",
      });
      if (error || !data || data.code !== 0 || !data.data) {
        throw new Error(data?.message || "无法加载角色权限");
      }
      setGrants(data.data.grants);
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
  function setPlatformGroup(keys: readonly string[], checked: boolean) {
    if (isSystemAdministrator) return;
    setGrants((current) => {
      const next = new Set(current);
      keys.forEach((key) => {
        const grant = key;
        if (checked) next.add(grant);
        else next.delete(grant);
      });
      return [...next];
    });
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
      const { data, error } = await updateRolePermissions({
        body: { grants },
        path: { roleId },
        responseStyle: "fields",
      });
      if (error || !data || data.code !== 0 || !data.data) {
        throw new Error(data?.message || "保存权限失败");
      }
      setGrants(data.data.grants);
      setMessage("权限配置已保存");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存权限失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsContentCard
      title="权限设置"
      subtitle="按角色配置应用、表单与平台功能的访问范围。"
      bodyScrollable={false}
      bodyClassName="flex min-h-0 flex-1 flex-col !overflow-hidden"
      footer={<><p className="text-xs leading-5 text-[var(--color-text-secondary)]">{message || (activeRole ? isSystemAdministrator ? "系统管理员拥有全部权限，权限不可修改。" : `正在配置「${activeRole.name}」的 RBAC 权限。` : "请先选择需要配置的角色。")}</p><Button variant="primary" isDisabled={!roleId || saving || isSystemAdministrator} onPress={() => void save()}>{saving ? "正在保存…" : "保存权限"}</Button></>}
    >
    <section className="grid min-h-0 w-full flex-1 grid-cols-[180px_minmax(0,1fr)] overflow-hidden">
      <aside className="flex min-h-0 flex-col overflow-hidden border-r border-[var(--color-border)] pr-4">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          授权角色
        </h2>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
          搜索并选择需要配置的角色
        </p>
        <Tabs
          variant="secondary"
          selectedKey={roleSourceFilter}
          onSelectionChange={(key) => setRoleSourceFilter(key as RoleSourceFilter)}
          className="mt-4"
        >
          <Tabs.List aria-label="角色来源筛选" className="w-full">
            <Tabs.Tab id="all" className="flex-1 px-1 py-1.5 text-[11px]">
              全部
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="local" className="flex-1 px-1 py-1.5 text-[11px]">
              平台
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="dingtalk" className="flex-1 px-1 py-1.5 text-[11px]">
              钉钉
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <Input
          aria-label="搜索角色"
          className="mt-3"
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
      <div className="flex min-h-0 flex-col overflow-hidden pl-4">
        <header className="shrink-0 pb-4">
          <div>
              <p className="text-sm text-[var(--color-text-secondary)]">
                {activeRole
                  ? isSystemAdministrator
                    ? "系统管理员拥有全部权限，权限不可修改"
                    : `正在配置「${activeRole.name}」的 RBAC 权限`
                  : "请先从左侧选择授权角色"}
              </p>
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
          <p className="mt-4 rounded-lg bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mt-4 rounded-lg bg-[var(--color-success-soft)] px-4 py-3 text-sm text-[var(--color-success)]">
            {message}
          </p>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!activeRole ? (
            <div className="flex h-full items-center justify-center"><Empty text="选择角色后可设置应用权限和平台权限。" /></div>
          ) : tab === "apps" ? (
            <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] overflow-hidden rounded-lg border border-[var(--color-border)]">
              <AppTree
                apps={apps}
                tree={tree}
                state={resourceState}
                onSelect={setSelectedResource}
                onSetAll={setAll}
                selected={selectedResource}
              />
              <div className="min-h-0 overflow-y-auto overscroll-contain"><ResourcePermissions resource={selectedResource} grants={grantSet} state={resourceState} onToggle={toggle} onSetScope={setScope} onSetVisibleViews={setVisibleViews} /></div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"><PlatformPermissions grants={grantSet} onToggle={toggle} onSetGroup={setPlatformGroup} /></div>
          )}
        </div>
      </div>
    </section>
    </SettingsContentCard>
  );
}

type PermissionTreeNode = {
  id: string;
  name: string;
  kind: "app" | "form";
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
  selected: { kind: "app" | "form"; id: string } | null;
}) {
  const data = useMemo<PermissionTreeNode[]>(
    () =>
      apps.map((app) => ({
        id: `app:${app.id}`,
        name: app.name,
        kind: "app",
        resourceId: app.id,
        children: buildFormNodes(tree[app.id] ?? [], null, app.id),
      })),
    [apps, tree],
  );
  return (
    <aside className="flex min-h-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-control-soft)] p-3">
      <p className="px-2 pb-3 text-xs font-semibold text-[var(--color-text-secondary)]">
        应用结构
      </p>
      {data.length ? (
        <Tree
          data={data}
          width="100%"
          height={480}
          indent={14}
          rowHeight={40}
          openByDefault
          disableDrag
          disableDrop
        >
          {({ node, style }: NodeRendererProps<PermissionTreeNode>) => {
            const item = node.data;
            const prefix = item.kind === "app" ? `app:${item.resourceId}` : `form:${item.resourceId}`;
            const actions = item.kind === "app" ? appActions : formActions;
            const status = state(prefix, actions);
            const active = selected?.kind === item.kind && selected.id === item.resourceId;
            return (
              <div style={style} className="px-1">
                <div
                  className={`flex h-[34px] items-center gap-1.5 rounded-lg px-2 ${active ? "bg-[var(--color-primary-soft)]" : "hover:bg-[var(--color-bg-hover)]"}`}
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
                  <PermissionCheckbox label={`授予${item.name}全部权限`} state={status} onChange={(checked) => onSetAll(prefix, actions, checked)} />
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: item.kind, id: item.resourceId!, label: item.name })}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs"
                  >
                    <TreeIcon kind={item.kind} />
                    <span className="truncate text-[12px] text-[var(--color-text-primary)]">
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
                    className="text-xs"
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
function buildFormNodes(
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
        ? buildFormNodes(items, item.id, appId)
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
function TreeIcon({ kind }: { kind: "app" | "form" }) {
  return kind === "app" ? (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 text-[var(--color-primary)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 7.5h8M8 11.5h8M8 15.5h5" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]"
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
        <>
          <PermissionPanel title="应用访问权限">
            <OperationChecks
              actions={["display"]}
              prefix={prefix}
              selected={selected}
              locked={locked}
              onToggle={onToggle}
              labels={appActionLabels}
            />
          </PermissionPanel>
          <PermissionPanel title="应用开发">
            <OperationChecks
              actions={applicationDevelopmentActions}
              prefix={prefix}
              selected={selected}
              locked={locked}
              onToggle={onToggle}
              labels={appActionLabels}
            />
          </PermissionPanel>
          <PermissionPanel title="表单开发">
            <OperationChecks actions={formDevelopmentActions} prefix={prefix} selected={selected} locked={locked} onToggle={onToggle} labels={appActionLabels} />
          </PermissionPanel>
          <PermissionPanel title="视图开发">
            <p className="mb-3 text-xs text-[var(--color-text-secondary)]">授予此权限后，可操作该应用下所有表单的视图、导入导出及批量功能。</p>
            <OperationChecks actions={["view_development"]} prefix={prefix} selected={selected} locked={locked} onToggle={onToggle} labels={appActionLabels} />
          </PermissionPanel>
        </>
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
  onSetGroup,
}: {
  grants: Set<string>;
  onToggle: (grant: string) => void;
  onSetGroup: (keys: readonly string[], checked: boolean) => void;
}) {
  const locked = grants.has("*");
  const stateFor = (keys: readonly string[]) => {
    if (locked || keys.every((key) => grants.has(key))) return "all";
    return keys.some((key) => grants.has(key)) ? "partial" : "none";
  };
  return (
    <section className="mx-auto max-w-3xl">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
        平台权限
      </h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        按平台导航层级配置访问范围；一级菜单可批量设置其全部二级页面。
      </p>
      <div className="mt-5 space-y-3">
        {platformPermissionGroups.map((group) => {
          const keys = group.items.map(([key]) => key);
          const status = stateFor(keys);
          return (
            <div key={group.key} className="overflow-hidden rounded-xl border border-[var(--color-border)]">
              <div className="flex items-center gap-3 bg-[var(--color-control-soft)] px-4 py-3">
                <PermissionCheckbox
                  label={`授予${group.label}下全部权限`}
                  state={status}
                  isDisabled={locked}
                  onChange={(checked) => onSetGroup(keys, checked)}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{group.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{group.description}</p>
                </div>
                <StatusTag value={status === "all" ? "全部授权" : status === "partial" ? "部分授权" : "未授权"} tone={status} />
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {group.items.map(([key, label, description]) => {
                  const granted = locked || grants.has(key);
                  return (
                    <Checkbox
                      key={key}
                      isSelected={granted}
                      isDisabled={locked}
                      onChange={() => onToggle(key)}
                      className="flex items-start justify-between px-4 py-3 pl-11 hover:bg-[var(--color-bg-hover)]"
                    >
                      <span className="flex items-start gap-3">
                        <Checkbox.Control className="mt-0.5"><Checkbox.Indicator /></Checkbox.Control>
                        <Checkbox.Content>
                          <span className="block text-sm font-medium">{label}</span>
                          <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{description}</span>
                        </Checkbox.Content>
                      </span>
                      <StatusTag value={granted ? "已授权" : "未授权"} tone={granted ? "all" : "none"} />
                    </Checkbox>
                  );
                })}
              </div>
            </div>
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
  return (
    <Checkbox
      aria-label={label}
      isSelected={state === "all"}
      isIndeterminate={state === "partial"}
      isDisabled={isDisabled}
      onChange={onChange}
      className="shrink-0"
    >
      <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
    </Checkbox>
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
  className = "",
}: {
  value: string;
  tone: "all" | "partial" | "none" | "neutral";
  className?: string;
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
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${toneClass} ${className}`}
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
