"use client";
import { Description, Typography } from "@heroui/react";
import {
  appActions,
  formActions,
  appActionLabels,
  applicationDevelopmentActions,
  formDevelopmentActions,
  formActionGroups,
} from "./permission-config";
import { Empty, StatusTag } from "./PermissionFeedback";
import {
  PermissionPanel,
  OperationChecks,
  ScopePanel,
} from "./PermissionPanel";
import { ViewScopePanel } from "./ViewScopePanel";
import type { PermissionResource, PermissionState } from "./permission-types";
export function ResourcePermissions({
  isReadOnly = false,
  resource,
  grants,
  state,
  onToggle,
  onSetScope,
  onSetVisibleViews,
}: {
  isReadOnly?: boolean;
  resource: PermissionResource | null;
  grants: Set<string>;
  state: (prefix: string, actions: readonly string[]) => PermissionState;
  onToggle: (grant: string) => void;
  onSetScope: (
    prefix: string,
    kind: "data_scope" | "view_scope",
    value: string,
  ) => void;
  onSetVisibleViews: (prefix: string, viewIds: string[]) => void;
}) {
  if (!resource) return <Empty text="从左侧选择应用或表单后配置具体权限。" />;
  const actions = resource.kind === "app" ? appActions : formActions;
  const prefix = `${resource.kind}:${resource.id}`;
  const locked = grants.has("*") || isReadOnly;
  function selected(action: string) {
    return grants.has("*") || grants.has(`${prefix}:${action}`);
  }
  function selectScope(kind: "data_scope" | "view_scope", value: string) {
    if (!locked) onSetScope(prefix, kind, value);
  }
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Description>{resource.kind === "app" ? "应用" : "表单"}</Description>
          <Typography type="h4">{resource.label}</Typography>
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
            <OperationChecks
              actions={formDevelopmentActions}
              prefix={prefix}
              selected={selected}
              locked={locked}
              onToggle={onToggle}
              labels={appActionLabels}
            />
          </PermissionPanel>
          <PermissionPanel title="视图开发">
            <Description>
              授予此权限后，可操作该应用下所有表单的视图、导入导出及批量功能。
            </Description>
            <OperationChecks
              actions={["view_development"]}
              prefix={prefix}
              selected={selected}
              locked={locked}
              onToggle={onToggle}
              labels={appActionLabels}
            />
          </PermissionPanel>
        </>
      ) : (
        <>
          <PermissionPanel title="操作权限">
            {formActionGroups.map(([title, groupActions]) => (
              <div
                key={title}
                className="grid grid-cols-[132px_minmax(0,1fr)] items-start gap-4"
              >
                <Description>{title}</Description>
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
