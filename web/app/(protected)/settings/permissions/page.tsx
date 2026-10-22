"use client";
import { assertApiResult, assertApiEnvelope } from "@lib/api-request";

import { notifyRequestError } from "@lib/notify";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Description,
  ScrollShadow,
  Tabs,
} from "@heroui/react";
import { normalizePlatformGrants } from "@features/identity-access/platform-permissions";
import { useAuth } from "@components/AuthProvider";
import { notify } from "@lib/notify";
import { mapWithConcurrency } from "@lib/async";
import {
  getRolePermissions,
  listRoles,
  updateRolePermissions,
} from "@/features/identity-access/api";
import { listAppNavigation, listApps } from "@/features/application/api";
import { AppTree } from "./components/AppTree";
import { Empty } from "./components/PermissionFeedback";
import { PlatformPermissions } from "./components/PlatformPermissions";
import { ResourcePermissions } from "./components/ResourcePermissions";
import { RoleNavigation } from "./components/RoleNavigation";
import { formActions } from "./components/permission-config";
import { listAiEmployeePermissionAgents } from "./components/permission-resources";
import { MySurface } from "@/components/ui/MySurface";
import type {
  Agent,
  App,
  NavigationItem,
  PermissionResource,
  Role,
  Tab,
} from "./components/permission-types";

export default function PermissionsSettingsPage() {
  const { hasPermission } = useAuth();
  const canManagePermissions = hasPermission("settings.permissions.manage");
  const [roles, setRoles] = useState<Role[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tree, setTree] = useState<Record<string, NavigationItem[]>>({});
  const [roleId, setRoleId] = useState("");
  const [tab, setTab] = useState<Tab>("apps");
  const [selectedResource, setSelectedResource] =
    useState<PermissionResource | null>(null);
  const [grants, setGrants] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const permissionRequest = useRef(0);
  const [loadedRoleId, setLoadedRoleId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activeRole = roles.find((role) => role.id === roleId);
  const isSystemAdministrator =
    activeRole?.externalId === "system-administrator";
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
      const [rolesResult, appsResult, agentsResult] = await Promise.all([
        listRoles({ responseStyle: "fields" }),
        listApps({ responseStyle: "fields" }),
        listAiEmployeePermissionAgents(),
      ]);
      assertApiResult(rolesResult);
      assertApiResult(appsResult);
      const rolesData = rolesResult.data;
      const appsData = appsResult.data;
      const agentsData = agentsResult.data;
      if (agentsResult.error || agentsData?.code !== 0 || !agentsData.data) throw new Error("无法加载 AI 员工权限资源");
      const nextRoles = rolesData.data.filter(
        (role) => role.status === "active",
      );
      const nextApps = appsData.data;
      setRoles(nextRoles);
      setApps(nextApps);
      setAgents(agentsData.data);
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
    const requestId = ++permissionRequest.current;
    setError("");
    try {
      const { data, error , response: httpResponse1 } = await getRolePermissions({
        path: { roleId: nextRoleId },
        responseStyle: "fields",
      });
      assertApiEnvelope(data, error, httpResponse1);
      if (requestId !== permissionRequest.current) return;
      setGrants(normalizePlatformGrants(data.data.grants));
      setLoadedRoleId(nextRoleId);
    } catch (reason) {
      if (requestId !== permissionRequest.current) return;
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
    if (saving || id === roleId) return;
    ++permissionRequest.current;
    setLoadedRoleId("");
    setGrants([]);
    setRoleId(id);
    setSelectedResource(null);
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
    if (isSystemAdministrator || !canManagePermissions || saving) return;
    const childFormIds = prefix.startsWith("app:")
      ? (tree[prefix.slice(4)] ?? [])
          .filter((item) => item.itemType === "form" && item.targetFormUuid)
          .map((item) => item.targetFormUuid!)
      : [];
    setGrants((current) => {
      const grantsToReplace = [
        ...actions.map((action) => `${prefix}:${action}`),
        ...childFormIds.flatMap((formId) =>
          formActions.map((action) => `form:${formId}:${action}`),
        ),
      ];
      const next = new Set(
        current.filter((grant) => !grantsToReplace.includes(grant)),
      );
      if (!checked) return [...next];

      actions.forEach((action) => next.add(`${prefix}:${action}`));
      childFormIds.forEach((formId) => {
        formActions.forEach((action) => next.add(`form:${formId}:${action}`));
      });
      if (prefix.startsWith("form:") && formAppIds.get(prefix.slice(5))) {
        next.add(`app:${formAppIds.get(prefix.slice(5))}:display`);
      }
      return [...next];
    });
  }
  function toggle(grant: string) {
    if (!isSystemAdministrator && canManagePermissions && !saving)
      setGrants((current) =>
        current.includes(grant)
          ? current.filter((item) => item !== grant)
          : [
              ...current,
              grant,
              ...(grant.startsWith("form:") &&
              formAppIds.get(grant.split(":")[1])
                ? [`app:${formAppIds.get(grant.split(":")[1])}:display`]
                : []),
            ],
      );
  }
  function setPlatformGroup(keys: readonly string[], checked: boolean) {
    if (isSystemAdministrator || !canManagePermissions || saving) return;
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
    if (!isSystemAdministrator && canManagePermissions && !saving)
      setGrants((current) => [
        ...current.filter((grant) => !grant.startsWith(`${prefix}:${kind}:`)),
        `${prefix}:${kind}:${value}`,
      ]);
  }
  function setVisibleViews(prefix: string, viewIds: string[]) {
    if (!isSystemAdministrator && canManagePermissions && !saving)
      setGrants((current) => [
        ...current.filter((grant) => !grant.startsWith(`${prefix}:view:`)),
        ...viewIds.map((viewId) => `${prefix}:view:${viewId}`),
      ]);
  }
  async function save() {
    if (!roleId || loadedRoleId !== roleId || saving || isSystemAdministrator || !canManagePermissions) return;
    setSaving(true);
    setError("");
    try {
      const { data, error , response: httpResponse2 } = await updateRolePermissions({
        body: { grants },
        path: { roleId },
        responseStyle: "fields",
      });
      assertApiEnvelope(data, error, httpResponse2);
      setGrants(normalizePlatformGrants(data.data.grants));
      notify.success("权限配置已保存");
      window.dispatchEvent(new Event("yaya-permissions-updated"));
    } catch (reason) {
      notifyRequestError(reason, "保存权限失败", {
        description: reason instanceof Error ? reason.message : "请稍后重试",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="h-full min-h-0 overflow-hidden">
      <Card.Header className="shrink-0">
        <Card.Title>权限设置</Card.Title>
        <Card.Description>
          按角色配置应用、表单与平台功能的访问范围。
        </Card.Description>
      </Card.Header>
      <Card.Content className="min-h-0 flex-1 basis-0 overflow-hidden">
        <div className="flex min-h-0 flex-1 basis-0 gap-4 overflow-hidden">
          <RoleNavigation
            roles={roles}
            selectedRoleId={roleId}
            loading={loading}
            onSelectRole={selectRole}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden">
            <header className="flex shrink-0 flex-col gap-3">
              <div>
                <Description>
                  {activeRole
                    ? isSystemAdministrator
                      ? "系统管理员拥有全部权限，权限不可修改"
                      : `正在配置「${activeRole.name}」的 RBAC 权限`
                    : "请先从左侧选择授权角色"}
                </Description>
              </div>
              {activeRole ? (
                <Tabs
                  variant="secondary"
                  selectedKey={tab}
                  onSelectionChange={(key) => setTab(key as Tab)}
                >
                  <Tabs.ListContainer>
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
                  </Tabs.ListContainer>
                </Tabs>
              ) : null}
            </header>
            {error ? (
              <Alert status="danger">
                <Alert.Content>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Content>
              </Alert>
            ) : null}
            <div className="flex min-h-0 flex-1 basis-0 flex-col overflow-hidden">
              {!activeRole || loadedRoleId !== roleId ? (
                <div className="flex h-full items-center justify-center">
                  <Empty text={activeRole ? "正在加载角色权限…" : "选择角色后可设置应用权限和平台权限。"} />
                </div>
              ) : tab === "apps" ? (
                <MySurface className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-4 overflow-hidden p-2">
                  <AppTree
                    isReadOnly={!canManagePermissions || saving || isSystemAdministrator}
                    apps={apps}
                    tree={tree}
                    state={resourceState}
                    onSelect={setSelectedResource}
                    onSetAll={setAll}
                    selected={selectedResource}
                  />
                  <ScrollShadow
                    aria-label="应用权限内容"
                    className="h-full min-h-0 min-w-0 overflow-y-auto overscroll-contain"
                  >
                    <ResourcePermissions
                      isReadOnly={!canManagePermissions || saving}
                      resource={selectedResource}
                      grants={grantSet}
                      state={resourceState}
                      onToggle={toggle}
                      onSetScope={setScope}
                      onSetVisibleViews={setVisibleViews}
                    />
                  </ScrollShadow>
                </MySurface>
              ) : (
                <ScrollShadow
                  aria-label="平台权限内容"
                  className="min-h-0 flex-1 basis-0 overflow-y-auto overscroll-contain"
                >
                  <PlatformPermissions
                    isReadOnly={!canManagePermissions || saving}
                    agents={agents}
                    grants={grantSet}
                    onToggle={toggle}
                    onSetGroup={setPlatformGroup}
                  />
                </ScrollShadow>
              )}
            </div>
          </div>
        </div>
      </Card.Content>
      <Card.Footer className="shrink-0 justify-between gap-4">
        <Description>{isSystemAdministrator ? "系统管理员拥有全部权限，权限不可修改。" : "勾选后点击保存权限生效。"}</Description>
        <Button variant="primary" isDisabled={!roleId || loadedRoleId !== roleId || saving || isSystemAdministrator || !canManagePermissions} onPress={() => void save()}>{saving ? "正在保存…" : "保存权限"}</Button>
      </Card.Footer>
    </Card>
  );
}
