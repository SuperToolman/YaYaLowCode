"use client";

import { use, useEffect, useState, type Key, type ReactNode } from "react";
import { Button, Card, Checkbox, CheckboxGroup, Chip, Input, ListBox, Select, Switch, TextArea, toast } from "@heroui/react";
import {
  Database,
  FileText,
  Gear,
  Lock,
  PersonGear,
  Shield,
} from "@gravity-ui/icons";
import { getFormSchema, publishFormSchema, saveFormSchemaDraft, setDefaultNavigationEntry, updateApp } from "../../../lib/api-client";
import type { RuntimeFormSchema } from "../../../components/runtime-form-renderer";
import {
  getAppForms,
  getAppNavigation,
  getAppResource,
  invalidateAppResources,
} from "../../../lib/app-resources";

type SettingsSection =
  | "basic"
  | "forms"
  | "administrators"
  | "permissions"
  | "data-factory";
type FormSettingsItem = { id: string; name: string; formType: "normal" | "workflow"; schema: RuntimeFormSchema; sortableFieldIds: string[] };

const SYSTEM_PAGE_PREFIX = "system:";
const systemPageOptions = [
  { slug: "todo", name: "待我处理" },
  { slug: "processed", name: "我处理的" },
  { slug: "created", name: "我创建的" },
  { slug: "copied", name: "抄送我的" },
];

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
  const [forms, setForms] = useState<FormSettingsItem[]>([]);
  const [selectedFormId, setSelectedFormId] = useState("");
  const [defaultEntryKey, setDefaultEntryKey] = useState(`${SYSTEM_PAGE_PREFIX}todo`);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void getAppResource(appId)
      .then((app) => {
        if (!cancelled) setAppName(app.name);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [appId]);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([getAppForms(appId), getAppNavigation(appId)])
      .then(async ([nextForms, navigationItems]) => {
        if (cancelled) return;
        const settings = await Promise.all(nextForms.map(async (form) => {
          const response = await getFormSchema({ path: { formUuid: form.id }, query: { scope: "published" }, responseStyle: "fields" });
          const schema = response.data?.data?.schema as RuntimeFormSchema | undefined;
          if (!schema) return null;
          const fieldIds = [...getTableFields(schema).map((field) => field.id), ...getBuiltinTableFields(form.formType).map((field) => field.id)];
          return { id: form.id, name: form.name, formType: form.formType, schema, sortableFieldIds: schema.pageProps?.table?.sortableFieldIds ?? fieldIds };
        }));
        if (cancelled) return;
        const loadedForms = settings.filter((item): item is FormSettingsItem => item !== null);
        setForms(loadedForms);
        setSelectedFormId((current) => current || loadedForms[0]?.id || "");
        const defaultEntry = navigationItems.find((item) => item.isDefaultEntry);
        setDefaultEntryKey(
          defaultEntry?.itemType === "system"
            ? `${SYSTEM_PAGE_PREFIX}${defaultEntry.pathSlug}`
            : defaultEntry?.targetFormUuid ?? `${SYSTEM_PAGE_PREFIX}todo`,
        );
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
    setIsSaving(true);
    try {
      const [appResult, navigationResult] = await Promise.all([
        updateApp({ path: { appId }, body: { name: nextName }, responseStyle: "fields" }),
        setDefaultNavigationEntry({
          path: { appId },
          body: defaultEntryKey.startsWith(SYSTEM_PAGE_PREFIX)
            ? { system_page_slug: defaultEntryKey.slice(SYSTEM_PAGE_PREFIX.length) }
            : { form_uuid: defaultEntryKey },
          responseStyle: "fields",
        }),
      ]);
      const appPayload = appResult.data;
      const navigationPayload = navigationResult.data;
      if (appResult.error || !appPayload || appPayload.code !== 0 || navigationResult.error || !navigationPayload || navigationPayload.code !== 0) {
        throw new Error(appPayload?.message || navigationPayload?.message || "保存失败");
      }
      invalidateAppResources(appId, ["app", "navigation"]);
      setAppName(appPayload.data?.name ?? nextName);
      toast.success("基础设置已保存", {
        description: "进入应用时将默认打开所选页面。",
      });
    } catch (error) {
      toast.danger("保存失败", { description: error instanceof Error ? error.message : "请稍后重试。" });
    } finally {
      setIsSaving(false);
    }
  }

  async function saveFormSettings() {
    setIsSaving(true);
    try {
      await Promise.all(forms.map(async (form) => {
        const schema = { ...form.schema, pageProps: { ...form.schema.pageProps, table: { ...form.schema.pageProps?.table, sortableFieldIds: form.sortableFieldIds } } };
        const saved = await saveFormSchemaDraft({ path: { formUuid: form.id }, body: { schema, changeLog: "更新数据表列排序显示" }, responseStyle: "fields" });
        if (saved.error || saved.data?.code !== 0) throw new Error(saved.data?.message || "保存表单设置失败");
        const published = await publishFormSchema({ path: { formUuid: form.id }, responseStyle: "fields" });
        if (published.error || published.data?.code !== 0) throw new Error(published.data?.message || "发布表单设置失败");
      }));
      toast.success("表单设置已保存");
    } catch (error) { toast.danger("保存失败", { description: error instanceof Error ? error.message : "请稍后重试。" }); }
    finally { setIsSaving(false); }
  }

  function toggleSortableField(formId: string, fieldId: string, selected: boolean) {
    setForms((current) => current.map((form) => form.id !== formId ? form : { ...form, sortableFieldIds: selected ? [...new Set([...form.sortableFieldIds, fieldId])] : form.sortableFieldIds.filter((id) => id !== fieldId) }));
  }

  return (
    <div className="h-full min-h-0 w-full">
      <div className="grid h-full min-h-0 w-full grid-cols-1 grid-rows-[220px_minmax(0,1fr)] gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="min-h-0">
          <Card className="theme-panel-strong flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel-soft)] p-0 shadow-[var(--shadow-designer)]">
            <Card.Header className="shrink-0 px-6 pb-4 pt-5">
              <p className="text-xs font-medium text-[var(--color-text-secondary)]">应用配置</p>
              <Card.Title className="mt-1 truncate text-lg font-semibold text-[var(--color-text-primary)]">
                {appName || "应用设置"}
              </Card.Title>
            </Card.Header>

            <Card.Content className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
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
                          <Button
                            key={child.id}
                            variant="ghost"
                            onPress={() => setActiveSection(child.id)}
                            className={[
                              "w-full justify-start rounded-lg px-3 py-2 text-left text-sm",
                              activeSection === child.id
                                ? "bg-[var(--color-primary-soft)] font-medium text-[var(--color-primary)]"
                                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]",
                            ].join(" ")}
                          >
                            {child.label}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </nav>
            </Card.Content>
          </Card>
        </aside>

        <main className="min-h-0 min-w-0 overflow-hidden">
          <SettingsContent
            activeSection={activeSection}
            appId={appId}
            appName={appName}
            onAppNameChange={setAppName}
            forms={forms}
            defaultEntryKey={defaultEntryKey}
            onDefaultEntryChange={setDefaultEntryKey}
            isSaving={isSaving}
            onSaveBasicSettings={saveBasicSettings}
            onSaveFormSettings={saveFormSettings}
            onToggleSortableField={toggleSortableField}
            selectedFormId={selectedFormId}
            onSelectedFormChange={setSelectedFormId}
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
    <Button
      variant="ghost"
      onPress={onClick}
      className={[
        "w-full justify-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm",
        active
          ? "bg-[var(--color-primary-soft)] font-medium text-[var(--color-primary)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]",
      ].join(" ")}
    >
      {icon}
      {label}
    </Button>
  );
}

function SettingsContent({
  activeSection,
  appId,
  appName,
  defaultEntryKey,
  forms,
  isSaving,
  onAppNameChange,
  onDefaultEntryChange,
  onSaveBasicSettings,
  onSaveFormSettings,
  onToggleSortableField,
  selectedFormId,
  onSelectedFormChange,
}: {
  activeSection: SettingsSection;
  appId: string;
  appName: string;
  defaultEntryKey: string;
  forms: FormSettingsItem[];
  isSaving: boolean;
  onAppNameChange: (value: string) => void;
  onDefaultEntryChange: (value: string) => void;
  onSaveBasicSettings: () => void;
  onSaveFormSettings: () => void;
  onToggleSortableField: (formId: string, fieldId: string, selected: boolean) => void;
  selectedFormId: string;
  onSelectedFormChange: (formId: string) => void;
}) {
  const meta = {
    basic: { title: "基础设置", description: "维护应用的基础信息和默认展示方式。" },
    forms: { title: "表单设置", description: "配置应用内表单的通用行为和数据规则。" },
    administrators: { title: "应用管理员", description: "管理可以维护应用配置和内容的成员。" },
    permissions: { title: "权限管理", description: "设置应用访问范围、角色和数据权限。" },
    "data-factory": { title: "数据工厂", description: "管理应用的数据同步、加工与导出策略。" },
  }[activeSection];

  return (
    <Card className="theme-panel-strong flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-0 shadow-[var(--shadow-designer)]">
      <SettingsContentHeader
        title={meta.title}
        description={meta.description}
        action={
          activeSection === "basic" || activeSection === "forms" ? (
            <Button className="h-9 px-4 text-sm" isPending={isSaving} onPress={activeSection === "basic" ? onSaveBasicSettings : onSaveFormSettings}>
              保存设置
            </Button>
          ) : null
        }
      />

      <Card.Content className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6 lg:px-8">
        <div className="space-y-5">
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
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">默认打开的页面</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">成员从应用入口进入时，将打开所选系统页面或表单。默认打开待我处理。</p>
                  <Select aria-label="默认打开的页面" fullWidth selectedKey={defaultEntryKey} onSelectionChange={(key: Key | null) => onDefaultEntryChange(key === null ? `${SYSTEM_PAGE_PREFIX}todo` : String(key))}>
                    <Select.Trigger><Select.Value>{systemPageOptions.find((page) => `${SYSTEM_PAGE_PREFIX}${page.slug}` === defaultEntryKey)?.name ?? forms.find((form) => form.id === defaultEntryKey)?.name ?? "待我处理"}</Select.Value><Select.Indicator /></Select.Trigger>
                    <Select.Popover><ListBox>
                      {systemPageOptions.map((page) => <ListBox.Item key={page.slug} id={`${SYSTEM_PAGE_PREFIX}${page.slug}`} textValue={page.name}>{page.name}</ListBox.Item>)}
                      {forms.map((form) => <ListBox.Item key={form.id} id={form.id} textValue={form.name}>{form.name}</ListBox.Item>)}
                    </ListBox></Select.Popover>
                  </Select>
                </div>
              </SettingsPanel>
            </>
          ) : null}

          {activeSection === "forms" ? <FormSortFieldsPanel forms={forms} selectedFormId={selectedFormId} onSelectedFormChange={onSelectedFormChange} onToggle={onToggleSortableField} /> : null}

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
      </Card.Content>
    </Card>
  );
}

function SettingsContentHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <Card.Header className="flex shrink-0 flex-col gap-3 border-b border-[var(--color-border)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
      <div className="min-w-0">
        <Card.Title className="text-xl font-semibold text-[var(--color-text-primary)]">
          {title}
        </Card.Title>
        <Card.Description className="mt-1.5 text-sm text-[var(--color-text-secondary)]">
          {description}
        </Card.Description>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </Card.Header>
  );
}

const BUILTIN_TABLE_FIELDS = [
  { id: "instanceId", label: "实例 ID" },
  { id: "instanceTitle", label: "实例标题" },
  { id: "submitter", label: "提交人" },
  { id: "submitterOrganization", label: "提交人组织" },
  { id: "createdAt", label: "创建时间" },
  { id: "updatedAt", label: "更新时间" },
];

const WORKFLOW_BUILTIN_TABLE_FIELDS = [
  { id: "workflowApprovalStatus", label: "审批状态" },
  { id: "workflowInstanceStatus", label: "实例状态" },
  { id: "workflowCurrentApprovalNode", label: "当前审批节点" },
  { id: "workflowSubmitter", label: "提交人" },
];

function getBuiltinTableFields(formType: FormSettingsItem["formType"]) {
  return formType === "workflow" ? [...WORKFLOW_BUILTIN_TABLE_FIELDS, ...BUILTIN_TABLE_FIELDS] : BUILTIN_TABLE_FIELDS;
}

function FormSortFieldsPanel({ forms, selectedFormId, onSelectedFormChange, onToggle }: { forms: FormSettingsItem[]; selectedFormId: string; onSelectedFormChange: (formId: string) => void; onToggle: (formId: string, fieldId: string, selected: boolean) => void }) {
  const form = forms.find((item) => item.id === selectedFormId);
  if (!form) return <SettingsPanel title="列排序按钮显示" description="当前应用还没有可配置的表单。" />;
  const fields = getTableFields(form.schema);
  const builtinItems = getBuiltinTableFields(form.formType);
  const designItems = fields.map((field) => ({ id: field.id, label: field.label }));
  const sortableItems = [...designItems, ...builtinItems];
  const selectedCount = sortableItems.filter((field) => form.sortableFieldIds.includes(field.id)).length;
  return (
    <SettingsPanel title="列排序按钮显示" description="选择表单后，勾选需要显示排序按钮的列。">
      <div className="space-y-2">
        <Select aria-label="选择表单" selectedKey={selectedFormId} onSelectionChange={(key) => onSelectedFormChange(String(key))}>
          <Select.Trigger><Select.Value><span className="flex min-w-0 items-center gap-2"><span className="truncate">{form.name}</span><Chip size="sm" variant="soft">{form.formType === "workflow" ? "流程表单" : "普通表单"}</Chip></span></Select.Value><Select.Indicator /></Select.Trigger>
          <Select.Popover><ListBox>{forms.map((item) => <ListBox.Item key={item.id} id={item.id} textValue={item.name}><span className="flex items-center justify-between gap-2"><span className="truncate">{item.name}</span><Chip size="sm" variant="soft">{item.formType === "workflow" ? "流程表单" : "普通表单"}</Chip></span></ListBox.Item>)}</ListBox></Select.Popover>
        </Select>
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]"><span>当前表单类型</span><Chip size="sm" variant="soft">{form.formType === "workflow" ? "流程表单" : "普通表单"}</Chip></div>
        <Checkbox isSelected={selectedCount === sortableItems.length} isIndeterminate={selectedCount > 0 && selectedCount < sortableItems.length} onChange={(selected) => sortableItems.forEach((field) => onToggle(form.id, field.id, selected))} className="h-7 px-1">
          <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><Checkbox.Content className="text-sm">{selectedCount === sortableItems.length ? "取消全选" : "全选排序列"}</Checkbox.Content>
        </Checkbox>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[var(--color-text-secondary)]">设计字段</p>
          {!designItems.length ? <Chip size="sm" variant="soft">当前表单没有可用于数据表的设计字段</Chip> : null}
        <CheckboxGroup aria-label="可排序的设计字段" value={form.sortableFieldIds.filter((id) => designItems.some((field) => field.id === id))} onChange={(values) => {
          const selected = new Set(values);
          designItems.forEach((field) => onToggle(form.id, field.id, selected.has(field.id)));
        }} className="grid gap-x-1 gap-y-0.5 [&_[data-slot=checkbox]]:!mt-0 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {designItems.map((field) => <Checkbox key={field.id} value={field.id} className="rounded-md border border-[var(--color-border)] px-2 py-1"><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><Checkbox.Content className="min-w-0 truncate text-sm">{field.label}</Checkbox.Content></Checkbox>)}
        </CheckboxGroup>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[var(--color-text-secondary)]">内置字段</p>
        <CheckboxGroup aria-label="可排序的内置字段" value={form.sortableFieldIds.filter((id) => builtinItems.some((field) => field.id === id))} onChange={(values) => {
          const selected = new Set(values);
          builtinItems.forEach((field) => onToggle(form.id, field.id, selected.has(field.id)));
        }} className="grid gap-x-1 gap-y-0.5 [&_[data-slot=checkbox]]:!mt-0 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {builtinItems.map((field) => <Checkbox key={field.id} value={field.id} className="rounded-md border border-[var(--color-border)] px-2 py-1"><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><Checkbox.Content className="min-w-0 truncate text-sm">{field.label}</Checkbox.Content></Checkbox>)}
        </CheckboxGroup>
        </div>
      </div>
    </SettingsPanel>
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
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-5 shadow-[var(--shadow-xs)]">
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

function getTableFields(schema: RuntimeFormSchema) {
  return schema.fields.filter((field) => !field.props?.isHidden && !["description", "groupContainer", "button", "link"].includes(field.type));
}
