"use client";

import { use, useEffect, useState, type Key, type ReactNode } from "react";
import { Button, Card, Input, ListBox, Select, Switch, TextArea, toast } from "@heroui/react";
import {
  Database,
  FileText,
  Gear,
  Lock,
  PersonGear,
  Shield,
} from "@gravity-ui/icons";

type SettingsSection =
  | "basic"
  | "forms"
  | "administrators"
  | "permissions"
  | "data-factory";

const navigationItems: Array<{
  id?: SettingsSection;
  label: string;
  icon: ReactNode;
  children?: Array<{ id: SettingsSection; label: string }>;
}> = [
  { id: "basic", label: "基础设置", icon: <Gear className="h-4 w-4" /> },
  { id: "forms", label: "表单设置", icon: <FileText className="h-4 w-4" /> },
  {
    label: "应用权限",
    icon: <Shield className="h-4 w-4" />,
    children: [
      { id: "administrators", label: "应用管理员" },
      { id: "permissions", label: "权限管理" },
    ],
  },
  {
    id: "data-factory",
    label: "数据工厂",
    icon: <Database className="h-4 w-4" />,
  },
];

export default function AppSettingsPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = use(params);
  const [activeSection, setActiveSection] = useState<SettingsSection>("basic");
  const [appName, setAppName] = useState("");
  const [forms, setForms] = useState<Array<{ id: string; name: string }>>([]);
  const [defaultFormUuid, setDefaultFormUuid] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void fetch(`/api/apps/${appId}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { code: number; data: { name?: string } | null }) => {
        if (!cancelled && payload.code === 0 && payload.data?.name) {
          setAppName(payload.data.name);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [appId]);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      fetch(`/api/apps/${appId}/forms`, { cache: "no-store" }).then((response) => response.json()),
      fetch(`/api/apps/${appId}/navigation`, { cache: "no-store" }).then((response) => response.json()),
    ])
      .then(([formsPayload, navigationPayload]) => {
        if (cancelled) return;
        const nextForms = formsPayload?.code === 0 && Array.isArray(formsPayload.data)
          ? formsPayload.data.map((form: { id: string; name: string }) => ({ id: form.id, name: form.name }))
          : [];
        setForms(nextForms);
        const defaultEntry = navigationPayload?.data?.find(
          (item: { itemType: string; isDefaultEntry: boolean }) =>
            item.itemType === "form" && item.isDefaultEntry,
        );
        setDefaultFormUuid(defaultEntry?.targetFormUuid ?? "");
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [appId]);

  async function saveBasicSettings() {
    const nextName = appName.trim();
    if (!nextName) {
      toast.danger("请输入应用名称");
      return;
    }
    if (!defaultFormUuid) {
      toast.danger("请选择默认打开的表单");
      return;
    }

    setIsSaving(true);
    try {
      const [appResponse, navigationResponse] = await Promise.all([
        fetch(`/api/apps/${appId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: nextName }),
        }),
        fetch(`/api/apps/${appId}/navigation/default-entry`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ form_uuid: defaultFormUuid }),
        }),
      ]);
      const [appPayload, navigationPayload] = await Promise.all([
        appResponse.json(),
        navigationResponse.json(),
      ]);
      if (!appResponse.ok || appPayload.code !== 0 || !navigationResponse.ok || navigationPayload.code !== 0) {
        throw new Error(appPayload.message || navigationPayload.message || "保存失败");
      }
      setAppName(appPayload.data?.name ?? nextName);
      toast.success("基础设置已保存", { description: "进入应用时将默认打开所选表单。" });
    } catch (error) {
      toast.danger("保存失败", { description: error instanceof Error ? error.message : "请稍后重试。" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-0 p-3 sm:p-5 lg:p-6">
      <div className="theme-panel-strong mx-auto flex min-h-[calc(100vh-150px)] w-full max-w-[1480px] overflow-hidden rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-designer)]">
        <aside className="w-[240px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-panel-soft)] p-4">
          <div className="mb-5 px-2">
            <p className="text-xs font-medium text-[var(--color-text-secondary)]">应用配置</p>
            <h1 className="mt-1 truncate text-lg font-semibold text-[var(--color-text-primary)]">
              {appName || "应用设置"}
            </h1>
          </div>

          <nav className="space-y-1" aria-label="应用设置导航">
            {navigationItems.map((item) => (
              <div key={item.label}>
                {item.id ? (
                  <SettingsNavButton
                    active={activeSection === item.id}
                    icon={item.icon}
                    label={item.label}
                    onClick={() => setActiveSection(item.id!)}
                  />
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)]">
                    {item.icon}
                    {item.label}
                  </div>
                )}
                {item.children ? (
                  <div className="ml-5 space-y-1 border-l border-[var(--color-border)] pl-3">
                    {item.children.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => setActiveSection(child.id)}
                        className={[
                          "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors",
                          activeSection === child.id
                            ? "bg-[var(--color-primary-soft)] font-medium text-[var(--color-primary)]"
                            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]",
                        ].join(" ")}
                      >
                        {child.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto bg-[var(--color-bg-surface)] p-6 lg:p-8">
          <SettingsContent
            activeSection={activeSection}
            appId={appId}
            appName={appName}
            onAppNameChange={setAppName}
            forms={forms}
            defaultFormUuid={defaultFormUuid}
            onDefaultFormChange={setDefaultFormUuid}
            isSaving={isSaving}
            onSaveBasicSettings={saveBasicSettings}
          />
        </main>
      </div>
    </div>
  );
}

function SettingsNavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
        active
          ? "bg-[var(--color-primary-soft)] font-medium text-[var(--color-primary)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}

function SettingsContent({
  activeSection,
  appId,
  appName,
  defaultFormUuid,
  forms,
  isSaving,
  onAppNameChange,
  onDefaultFormChange,
  onSaveBasicSettings,
}: {
  activeSection: SettingsSection;
  appId: string;
  appName: string;
  defaultFormUuid: string;
  forms: Array<{ id: string; name: string }>;
  isSaving: boolean;
  onAppNameChange: (value: string) => void;
  onDefaultFormChange: (value: string) => void;
  onSaveBasicSettings: () => void;
}) {
  const meta = {
    basic: { title: "基础设置", description: "维护应用的基础信息和默认展示方式。" },
    forms: { title: "表单设置", description: "配置应用内表单的通用行为和数据规则。" },
    administrators: { title: "应用管理员", description: "管理可以维护应用配置和内容的成员。" },
    permissions: { title: "权限管理", description: "设置应用访问范围、角色和数据权限。" },
    "data-factory": { title: "数据工厂", description: "管理应用的数据同步、加工与导出策略。" },
  }[activeSection];

  return (
    <div className="w-full">
      <div className="flex flex-col gap-3 border-b border-[var(--color-border)] pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-[var(--color-text-primary)]">{meta.title}</h2>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{meta.description}</p>
        </div>
        {activeSection === "basic" ? <Button className="h-9 px-4 text-sm" isPending={isSaving} onPress={onSaveBasicSettings}>保存设置</Button> : null}
      </div>

      <div className="space-y-5 py-6">
        {activeSection === "basic" ? (
          <>
            <SettingsPanel title="应用信息" description="设置应用名称、标识及说明。">
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  aria-label="应用名称"
                  value={appName}
                  placeholder="请输入应用名称"
                  onChange={(event) => onAppNameChange(event.currentTarget.value)}
                />
                <Input aria-label="应用标识" value={appId} readOnly />
              </div>
              <TextArea aria-label="应用说明" className="mt-4 min-h-28" defaultValue="用于集中管理业务表单、流程与数据。" />
            </SettingsPanel>
            <SettingsPanel title="默认展示" description="控制进入应用后的默认页面与导航行为。">
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--color-text-primary)]">默认打开的表单</p>
                <p className="text-xs text-[var(--color-text-secondary)]">成员从应用入口进入时，将直接打开此表单。</p>
                <Select aria-label="默认打开的表单" fullWidth selectedKey={defaultFormUuid || null} isDisabled={!forms.length} onSelectionChange={(key: Key | null) => onDefaultFormChange(key === null ? "" : String(key))}>
                  <Select.Trigger><Select.Value>{forms.find((form) => form.id === defaultFormUuid)?.name ?? (forms.length ? "请选择表单" : "当前应用还没有表单")}</Select.Value><Select.Indicator /></Select.Trigger>
                  <Select.Popover><ListBox>{forms.map((form) => <ListBox.Item key={form.id} id={form.id} textValue={form.name}>{form.name}</ListBox.Item>)}</ListBox></Select.Popover>
                </Select>
              </div>
            </SettingsPanel>
          </>
        ) : null}

        {activeSection === "forms" ? (
          <>
            <SettingsPanel title="表单行为" description="对应用内全部表单生效的默认配置。">
              <SettingToggle label="允许导入数据" description="允许成员从文件批量导入表单数据。" defaultChecked />
              <SettingToggle label="允许导出数据" description="允许具备权限的成员导出表单数据。" defaultChecked />
              <SettingToggle label="保留编辑历史" description="记录数据的修改人与修改时间。" defaultChecked />
            </SettingsPanel>
            <SettingsPanel title="数据校验" description="统一控制提交和更新数据时的校验方式。">
              <SettingToggle label="提交前校验必填项" description="阻止未填写必填字段的数据提交。" defaultChecked />
              <SettingToggle label="启用重复数据检测" description="根据表单唯一字段提示重复记录。" />
            </SettingsPanel>
          </>
        ) : null}

        {activeSection === "administrators" ? (
          <SettingsPanel title="管理员列表" description="管理员可以设计表单、配置权限并发布应用。">
            <MemberRow name="管理员" role="超级管理员" icon={<PersonGear className="h-4 w-4" />} />
            <div className="mt-4 rounded-xl border border-dashed border-[var(--color-border)] px-4 py-6 text-center text-sm text-[var(--color-text-secondary)]">
              暂无其他应用管理员
            </div>
            <Button variant="ghost" className="mt-4 border border-[var(--color-border)] text-[var(--color-primary)]">
              添加管理员
            </Button>
          </SettingsPanel>
        ) : null}

        {activeSection === "permissions" ? (
          <>
            <SettingsPanel title="访问权限" description="配置谁可以进入和使用当前应用。">
              <SettingToggle label="允许企业成员访问" description="企业内成员可在应用中心找到当前应用。" defaultChecked />
              <SettingToggle label="允许外部链接访问" description="通过公开链接访问指定表单页面。" />
            </SettingsPanel>
            <SettingsPanel title="角色权限" description="按角色分配表单、数据和配置权限。">
              <MemberRow name="管理员" role="全部权限" icon={<Shield className="h-4 w-4" />} />
              <MemberRow name="普通成员" role="查看与提交" icon={<Lock className="h-4 w-4" />} />
            </SettingsPanel>
          </>
        ) : null}

        {activeSection === "data-factory" ? (
          <>
            <SettingsPanel title="数据同步" description="配置应用数据的加工和同步策略。">
              <SettingToggle label="启用定时同步" description="按照计划将表单数据同步到目标数据源。" />
              <SettingToggle label="失败自动重试" description="数据处理失败后自动尝试重新执行。" defaultChecked />
            </SettingsPanel>
            <SettingsPanel title="数据任务" description="数据清洗、合并和转换任务将在这里管理。">
              <div className="rounded-xl border border-dashed border-[var(--color-border)] px-5 py-10 text-center text-sm text-[var(--color-text-secondary)]">
                暂无数据工厂任务
              </div>
            </SettingsPanel>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SettingsPanel({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <Card className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-5 shadow-[var(--shadow-xs)]">
      <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h3>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{description}</p>
      <div className="mt-5">{children}</div>
    </Card>
  );
}

function SettingToggle({
  defaultChecked = false,
  description,
  label,
}: {
  defaultChecked?: boolean;
  description: string;
  label: string;
}) {
  return (
    <label className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] py-4 last:border-b-0">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--color-text-primary)]">{label}</span>
        <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">{description}</span>
      </span>
      <Switch isSelected={defaultChecked} aria-label={label}>
        <Switch.Control><Switch.Thumb /></Switch.Control>
      </Switch>
    </label>
  );
}

function MemberRow({ icon, name, role }: { icon: ReactNode; name: string; role: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
          {icon}
        </span>
        <span className="text-sm font-medium text-[var(--color-text-primary)]">{name}</span>
      </div>
      <span className="rounded-full bg-[var(--color-bg-subtle)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">
        {role}
      </span>
    </div>
  );
}
