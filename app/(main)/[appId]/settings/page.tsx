"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import { Button, Input, toast } from "@heroui/react";
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
  onAppNameChange,
}: {
  activeSection: SettingsSection;
  appId: string;
  appName: string;
  onAppNameChange: (value: string) => void;
}) {
  const meta = {
    basic: { title: "基础设置", description: "维护应用的基础信息和默认展示方式。" },
    forms: { title: "表单设置", description: "配置应用内表单的通用行为和数据规则。" },
    administrators: { title: "应用管理员", description: "管理可以维护应用配置和内容的成员。" },
    permissions: { title: "权限管理", description: "设置应用访问范围、角色和数据权限。" },
    "data-factory": { title: "数据工厂", description: "管理应用的数据同步、加工与导出策略。" },
  }[activeSection];

  return (
    <div className="mx-auto max-w-[980px]">
      <div className="flex flex-col gap-3 border-b border-[var(--color-border)] pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-[var(--color-text-primary)]">{meta.title}</h2>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{meta.description}</p>
        </div>
        <Button
          className="h-9 rounded-lg bg-[var(--color-primary)] px-4 text-sm text-[var(--color-text-on-primary)]"
          onPress={() =>
            toast.success("设置已暂存", { description: "当前为纯前端页面，暂未提交到后端。" })
          }
        >
          保存设置
        </Button>
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
              <textarea
                aria-label="应用说明"
                className="mt-4 min-h-28 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
                defaultValue="用于集中管理业务表单、流程与数据。"
              />
            </SettingsPanel>
            <SettingsPanel title="默认展示" description="控制进入应用后的默认页面与导航行为。">
              <SettingToggle label="自动进入默认表单" description="访问应用根路径时打开默认导航项。" defaultChecked />
              <SettingToggle label="显示系统页面" description="在应用导航中展示待办、已处理等系统页面。" defaultChecked />
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
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-5 shadow-[var(--shadow-xs)]">
      <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h3>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
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
      <input
        type="checkbox"
        defaultChecked={defaultChecked}
        className="h-4 w-4 accent-[var(--color-primary)]"
      />
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
