"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, Switch, Tabs } from "@heroui/react";
import { Field } from "../_components/field";

type ProviderTab = "local" | "dingtalk" | "wecom" | "feishu";
type ApiEnvelope<T> = { code: number; message: string; data: T | null };
type DingTalkSettings = {
  appId: string;
  agentId: string;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  accessTokenExpiresAt: string | null;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  includeChildDepartments: boolean;
  disableDepartedUsers: boolean;
  allowJitProvisioning: boolean;
};
type IdentitySourceSettings = {
  dingtalk: DingTalkSettings;
};

const defaultSettings: IdentitySourceSettings = {
  dingtalk: {
    appId: "",
    agentId: "",
    clientId: "",
    clientSecret: "",
    accessToken: "",
    accessTokenExpiresAt: null,
    syncEnabled: false,
    syncIntervalMinutes: 720,
    includeChildDepartments: true,
    disableDepartedUsers: true,
    allowJitProvisioning: false,
  },
};

const providerTabs: Array<{ id: ProviderTab; label: string }> = [
  { id: "local", label: "平台账号" },
  { id: "dingtalk", label: "钉钉" },
  { id: "wecom", label: "企业微信" },
  { id: "feishu", label: "飞书" },
];

export default function IdentitySourceSettingsPage() {
  const [activeTab, setActiveTab] = useState<ProviderTab>("local");
  const [form, setForm] = useState<IdentitySourceSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchingToken, setFetchingToken] = useState(false);
  const [syncingDingTalk, setSyncingDingTalk] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearingDingTalk, setClearingDingTalk] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canFetchAccessToken = [
    form.dingtalk.appId,
    form.dingtalk.agentId,
    form.dingtalk.clientId,
    form.dingtalk.clientSecret,
  ].every((value) => value.trim().length > 0);

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/settings/identity-source", { cache: "no-store" });
        const payload = (await response.json()) as ApiEnvelope<IdentitySourceSettings>;
        if (!response.ok || payload.code !== 0 || !payload.data) {
          throw new Error(payload.message || "无法加载身份源配置");
        }
        setForm(payload.data);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "无法加载身份源配置");
      } finally {
        setLoading(false);
      }
    };
    void loadSettings();
  }, []);

  function updateDingTalk<K extends keyof DingTalkSettings>(field: K, value: DingTalkSettings[K]) {
    setForm((current) => ({
      ...current,
      dingtalk: {
        ...current.dingtalk,
        [field]: value,
        ...(["appId", "agentId", "clientId", "clientSecret"].includes(field)
          ? { accessToken: "", accessTokenExpiresAt: null }
          : {}),
      },
    }));
  }

  async function saveSettings() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/settings/identity-source", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = (await response.json()) as ApiEnvelope<IdentitySourceSettings>;
      if (!response.ok || payload.code !== 0 || !payload.data) {
        throw new Error(payload.message || "保存身份源配置失败");
      }
      setForm(payload.data);
      setMessage("身份源配置已保存并立即生效，无需重启服务。");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存身份源配置失败");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function fetchAccessToken() {
    setFetchingToken(true);
    setMessage("");
    setError("");
    try {
      const saved = await saveSettings();
      if (!saved) return;
      const response = await fetch("/api/settings/identity-source/dingtalk/access-token", {
        method: "POST",
      });
      const payload = (await response.json()) as ApiEnvelope<{
        accessToken: string;
        expiresIn: number;
        expiresAt: string;
      }>;
      if (!response.ok || payload.code !== 0 || !payload.data) {
        throw new Error(payload.message || "获取 AccessToken 失败");
      }
      setForm((current) => ({
        ...current,
        dingtalk: {
          ...current.dingtalk,
          accessToken: payload.data!.accessToken,
          accessTokenExpiresAt: payload.data!.expiresAt,
        },
      }));
      setMessage(`AccessToken 已获取并保存，有效期至 ${new Date(payload.data.expiresAt).toLocaleString("zh-CN")}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "获取 AccessToken 失败");
    } finally {
      setFetchingToken(false);
    }
  }

  async function syncDingTalk() {
    setSyncingDingTalk(true);
    setMessage("");
    setError("");
    try {
      const saved = await saveSettings();
      if (!saved) return;
      const departmentResponse = await fetch("/api/settings/identity-source/dingtalk/sync-departments", {
        method: "POST",
      });
      const departmentPayload = (await departmentResponse.json()) as ApiEnvelope<{
        total: number;
        created: number;
        updated: number;
        disabled: number;
        synchronizedAt: string;
      }>;
      if (!departmentResponse.ok || departmentPayload.code !== 0 || !departmentPayload.data) {
        throw new Error(departmentPayload.message || "同步钉钉组织架构失败");
      }
      const userResponse = await fetch("/api/settings/identity-source/dingtalk/sync-users", {
        method: "POST",
      });
      const userPayload = (await userResponse.json()) as ApiEnvelope<{
        total: number;
        created: number;
        updated: number;
        disabled: number;
        avatars: number;
        memberships: number;
        roles: number;
        roleBindings: number;
        synchronizedAt: string;
      }>;
      if (!userResponse.ok || userPayload.code !== 0 || !userPayload.data) {
        throw new Error(userPayload.message || "同步钉钉用户失败");
      }
      setMessage(`钉钉同步完成：部门 ${departmentPayload.data.total} 个（新增 ${departmentPayload.data.created} 个，更新 ${departmentPayload.data.updated} 个），用户 ${userPayload.data.total} 人（新增 ${userPayload.data.created} 人，更新 ${userPayload.data.updated} 人），角色 ${userPayload.data.roles} 个。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "同步钉钉数据失败");
    } finally {
      setSyncingDingTalk(false);
    }
  }

  async function clearDingTalkData() {
    setClearingDingTalk(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/settings/identity-source/dingtalk/clear", { method: "POST" });
      const payload = (await response.json()) as ApiEnvelope<{
        deletedUsers: number;
        deletedRoles: number;
        deletedOrganizationUnits: number;
        deletedRolePermissions: number;
      }>;
      if (!response.ok || payload.code !== 0 || !payload.data) {
        throw new Error(payload.message || "清除钉钉数据失败");
      }
      setClearConfirmOpen(false);
      setMessage(`已清除钉钉数据：${payload.data.deletedOrganizationUnits} 个组织、${payload.data.deletedUsers} 个用户、${payload.data.deletedRoles} 个角色，以及 ${payload.data.deletedRolePermissions} 项角色权限配置。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "清除钉钉数据失败");
    } finally {
      setClearingDingTalk(false);
    }
  }

  return (
    <section className="theme-panel h-full min-h-0 overflow-hidden rounded-[24px] shadow-[var(--shadow-card)]">
      <Tabs
        variant="secondary"
        selectedKey={activeTab}
        onSelectionChange={(key) => setActiveTab(key as ProviderTab)}
        className="flex h-full min-h-0 flex-col"
      >
        <div className="shrink-0 border-b border-[var(--color-border)] px-6 pt-6">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">身份源设置</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">
                配置平台账号或第三方组织身份源。所有配置由后端保存，修改后立即生效。
              </p>
          </div>

          <Tabs.ListContainer className="mt-5 overflow-x-auto">
            <Tabs.List aria-label="身份源类型" className="min-w-max">
              {providerTabs.map((tab) => (
                <Tabs.Tab key={tab.id} id={tab.id} className="min-w-24 px-4 py-3 text-center text-sm font-semibold">
                  {tab.label}
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
          <Tabs.Panel id="local" className="outline-none">
            <div className="space-y-5">
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-control-soft)] p-5">
                <div>
                  <div className="text-base font-semibold text-[var(--color-text-primary)]">平台用户体系</div>
                  <p className="mt-1 max-w-xl text-sm leading-6 text-[var(--color-text-secondary)]">用户由管理员创建，组织和角色均在平台内维护，不提供公开注册入口。平台账号与已配置的第三方身份源可以同时登录。</p>
                </div>
              </div>
            </div>
          </Tabs.Panel>

          <Tabs.Panel id="dingtalk" className="outline-none">
            <div className="space-y-6">
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-control-soft)] p-4">
                <div>
                  <div className="text-sm font-semibold text-[var(--color-text-primary)]">钉钉组织身份源</div>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">配置凭据后，钉钉账号可与平台账号同时登录；用户和部门由钉钉同步，平台继续负责角色映射与权限计算。</p>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">应用凭证</h3>
                <div className="mt-4 grid gap-5 sm:grid-cols-2">
                  <Field label="App ID"><Input fullWidth value={form.dingtalk.appId} disabled={loading || saving} onChange={(event) => updateDingTalk("appId", event.currentTarget.value)} /></Field>
                  <Field label="原企业内部应用 AgentId"><Input fullWidth value={form.dingtalk.agentId} disabled={loading || saving} onChange={(event) => updateDingTalk("agentId", event.currentTarget.value)} /></Field>
                </div>
                <div className="mt-5 grid gap-5 lg:grid-cols-3">
                  <Field label="Client ID" hint="原 AppKey 和 SuiteKey"><Input fullWidth value={form.dingtalk.clientId} disabled={loading || saving} onChange={(event) => updateDingTalk("clientId", event.currentTarget.value)} /></Field>
                  <Field label="Client Secret" hint="原 AppSecret 和 SuiteSecret"><Input fullWidth value={form.dingtalk.clientSecret} disabled={loading || saving} onChange={(event) => updateDingTalk("clientSecret", event.currentTarget.value)} /></Field>
                  <Field label="AccessToken">
                    <div className="flex gap-2">
                      <Input fullWidth value={form.dingtalk.accessToken} readOnly placeholder="尚未获取" />
                      <Button className="shrink-0" isDisabled={loading || saving || fetchingToken || !canFetchAccessToken} onPress={() => void fetchAccessToken()}>{fetchingToken ? "正在获取…" : "获取 AccessToken"}</Button>
                    </div>
                  </Field>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">同步与登录策略</h3>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      isDisabled={loading || saving || syncingDingTalk || clearingDingTalk || !canFetchAccessToken}
                      onPress={() => void syncDingTalk()}
                    >
                      {syncingDingTalk ? "正在同步…" : "同步组织与用户"}
                    </Button>
                    <Button
                      className="bg-[var(--color-danger)] text-white"
                      isDisabled={loading || saving || syncingDingTalk || clearingDingTalk}
                      onPress={() => setClearConfirmOpen(true)}
                    >
                      清除钉钉数据
                    </Button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <ToggleRow label="自动同步通讯录" description="默认每 12 小时更新一次部门和用户。" checked={form.dingtalk.syncEnabled} disabled={loading || saving} onChange={(checked) => updateDingTalk("syncEnabled", checked)} />
                  <ToggleRow label="包含所有子部门" description="同步组织下的全部下级部门。" checked={form.dingtalk.includeChildDepartments} disabled={loading || saving} onChange={(checked) => updateDingTalk("includeChildDepartments", checked)} />
                  <ToggleRow label="自动停用离职用户" description="钉钉用户离职后禁止登录但保留业务数据。" checked={form.dingtalk.disableDepartedUsers} disabled={loading || saving} onChange={(checked) => updateDingTalk("disableDepartedUsers", checked)} />
                  <ToggleRow label="登录时自动创建用户" description="未同步用户首次登录时自动建立平台用户。" checked={form.dingtalk.allowJitProvisioning} disabled={loading || saving} onChange={(checked) => updateDingTalk("allowJitProvisioning", checked)} />
                </div>
                <div className="mt-5 max-w-xs">
                  <Field label="同步周期（小时）">
                    <Input
                      fullWidth
                      type="number"
                      min="1"
                      max="168"
                      value={String(Math.max(1, form.dingtalk.syncIntervalMinutes / 60))}
                      disabled={loading || saving}
                      onChange={(event) => updateDingTalk("syncIntervalMinutes", Number(event.currentTarget.value) * 60)}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </Tabs.Panel>

          <Tabs.Panel id="wecom" className="outline-none">
            <ProviderPlaceholder name="企业微信" />
          </Tabs.Panel>
          <Tabs.Panel id="feishu" className="outline-none">
            <ProviderPlaceholder name="飞书" />
          </Tabs.Panel>

          {message ? <p className="mt-5 rounded-xl bg-[var(--color-info-soft)] px-4 py-3 text-sm text-[var(--color-info)]">{message}</p> : null}
          {error ? <p className="mt-5 rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">{error}</p> : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--color-border)] bg-[var(--color-bg-surface)] px-6 py-4">
          <p className="text-xs text-[var(--color-text-secondary)]">配置保存在后端本地设置文件中。</p>
          <Button
            isDisabled={loading || saving || activeTab === "wecom" || activeTab === "feishu"}
            onPress={() => void saveSettings()}
          >
            {saving ? "正在保存…" : "保存配置"}
          </Button>
        </div>
      </Tabs>
      <Modal
        isOpen={clearConfirmOpen}
        onOpenChange={(open) => !clearingDingTalk && setClearConfirmOpen(open)}
      >
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable={!clearingDingTalk}>
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog className="rounded-2xl bg-[var(--color-bg-surface)]">
              <Modal.Header>
                <Modal.Heading>清除钉钉同步数据</Modal.Heading>
                <Modal.CloseTrigger aria-label="关闭" isDisabled={clearingDingTalk} />
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
                  确认清除所有钉钉来源的组织架构、用户、角色及角色权限配置吗？此操作不可恢复，不会删除钉钉应用凭据。
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" isDisabled={clearingDingTalk} onPress={() => setClearConfirmOpen(false)}>
                  取消
                </Button>
                <Button className="bg-[var(--color-danger)] text-white" isDisabled={clearingDingTalk} onPress={() => void clearDingTalkData()}>
                  {clearingDingTalk ? "正在清除…" : "确认清除"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </section>
  );
}

function ToggleRow({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Switch
      isSelected={checked}
      isDisabled={disabled}
      onChange={onChange}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-control-soft)] p-4"
    >
      <Switch.Content>
        <span className="block text-sm font-medium text-[var(--color-text-primary)]">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--color-text-secondary)]">{description}</span>
      </Switch.Content>
      <Switch.Control><Switch.Thumb /></Switch.Control>
    </Switch>
  );
}

function ProviderPlaceholder({ name }: { name: string }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-6 text-center">
      <div className="text-base font-semibold text-[var(--color-text-primary)]">{name}身份源</div>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--color-text-secondary)]">Tab 和配置扩展位置已经预留，后续接入时可以复用当前身份源接口与统一用户映射模型。</p>
      <span className="mt-4 rounded-full bg-[var(--color-warning-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--color-warning)]">待接入</span>
    </div>
  );
}
