"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, Switch, Tabs } from "@heroui/react";
import { Field } from "../components/Field";
import { SettingsContentCard } from "../components/SettingsContentCard";
import { OrganizationArchitectureSection } from "../components/OrganizationArchitectureSection";
import {
  clearDingTalkIdentityData,
  getIdentitySettings,
  refreshDingTalkToken,
  saveIdentitySettings,
  synchronizeDingTalkDepartments,
  synchronizeDingTalkUsers,
} from "@features/settings/api";

type ProviderTab = "local" | "dingtalk" | "wecom" | "feishu";
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
  const [syncConfigOpen, setSyncConfigOpen] = useState(false);
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
        setForm(await getIdentitySettings<IdentitySourceSettings>());
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : "无法加载身份源配置",
        );
      } finally {
        setLoading(false);
      }
    };
    void loadSettings();
  }, []);

  function updateDingTalk<K extends keyof DingTalkSettings>(
    field: K,
    value: DingTalkSettings[K],
  ) {
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
      const payload = await saveIdentitySettings<IdentitySourceSettings>(form);
      setForm(payload);
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
      const payload = await refreshDingTalkToken<{
        accessToken: string;
        expiresIn: number;
        expiresAt: string;
      }>();
      setForm((current) => ({
        ...current,
        dingtalk: {
          ...current.dingtalk,
          accessToken: payload.accessToken,
          accessTokenExpiresAt: payload.expiresAt,
        },
      }));
      setMessage(
        `AccessToken 已获取并保存，有效期至 ${new Date(payload.expiresAt).toLocaleString("zh-CN")}`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "获取 AccessToken 失败",
      );
    } finally {
      setFetchingToken(false);
    }
  }

  async function syncDingTalk(): Promise<boolean> {
    setSyncingDingTalk(true);
    setMessage("");
    setError("");
    try {
      const saved = await saveSettings();
      if (!saved) return false;
      const departmentPayload = await synchronizeDingTalkDepartments<{
        total: number;
        created: number;
        updated: number;
        disabled: number;
        synchronizedAt: string;
      }>();
      const userPayload = await synchronizeDingTalkUsers<{
        total: number;
        created: number;
        updated: number;
        disabled: number;
        avatars: number;
        memberships: number;
        roles: number;
        roleBindings: number;
        synchronizedAt: string;
      }>();
      setMessage(
        `钉钉同步完成：部门 ${departmentPayload.total} 个（新增 ${departmentPayload.created} 个，更新 ${departmentPayload.updated} 个），用户 ${userPayload.total} 人（新增 ${userPayload.created} 人，更新 ${userPayload.updated} 人），角色 ${userPayload.roles} 个。`,
      );
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "同步钉钉数据失败");
      return false;
    } finally {
      setSyncingDingTalk(false);
    }
  }

  async function clearDingTalkData() {
    setClearingDingTalk(true);
    setMessage("");
    setError("");
    try {
      const payload = await clearDingTalkIdentityData<{
        deletedUsers: number;
        deletedRoles: number;
        deletedOrganizationUnits: number;
        deletedRolePermissions: number;
      }>();
      setClearConfirmOpen(false);
      setMessage(
        `已清除钉钉数据：${payload.deletedOrganizationUnits} 个组织、${payload.deletedUsers} 个用户、${payload.deletedRoles} 个角色，以及 ${payload.deletedRolePermissions} 项角色权限配置。`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "清除钉钉数据失败");
    } finally {
      setClearingDingTalk(false);
    }
  }

  return (
    <SettingsContentCard
      title="身份源与组织架构"
      subtitle="配置平台账号或第三方身份源，并查看各来源同步的组织架构。所有配置由后端保存，修改后立即生效。"
      footer={
        <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
          配置保存在后端本地设置文件中。
        </p>
      }
    >
      <Tabs
        variant="secondary"
        selectedKey={activeTab}
        onSelectionChange={(key) => setActiveTab(key as ProviderTab)}
        className="flex h-full min-h-0 flex-col"
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="身份源类型" className="min-w-max">
            {providerTabs.map((tab) => (
              <Tabs.Tab
                key={tab.id}
                id={tab.id}
                className="min-w-24 px-4 py-3 text-center text-sm font-semibold"
              >
                {tab.label}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="local" className="outline-none">
          <OrganizationArchitectureSection
            sourceType="local"
            sourceLabel="平台"
          />
        </Tabs.Panel>

        <Tabs.Panel id="dingtalk" className="outline-none">
          <OrganizationArchitectureSection
            sourceType="dingtalk"
            sourceLabel="钉钉"
            actions={
              <>
                <Button variant="secondary" isDisabled={loading || syncingDingTalk || clearingDingTalk} onPress={() => setSyncConfigOpen(true)}>
                  {syncingDingTalk ? "正在同步…" : "同步组织与用户"}
                </Button>
                <Button className="bg-[var(--color-danger)] text-white" isDisabled={loading || saving || syncingDingTalk || clearingDingTalk} onPress={() => setClearConfirmOpen(true)}>
                  清除钉钉数据
                </Button>
              </>
            }
          />
        </Tabs.Panel>

        <Tabs.Panel id="wecom" className="outline-none">
          <ProviderPlaceholder name="企业微信" />
        </Tabs.Panel>

        <Tabs.Panel id="feishu" className="outline-none">
          <ProviderPlaceholder name="飞书" />
        </Tabs.Panel>
      </Tabs>
      {message ? (
        <p className="mt-5 rounded-xl bg-[var(--color-info-soft)] px-4 py-3 text-sm text-[var(--color-info)]">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-5 rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
      <Modal
        isOpen={syncConfigOpen}
        onOpenChange={(open) =>
          !syncingDingTalk && !saving && setSyncConfigOpen(open)
        }
      >
        <Modal.Backdrop
          className="theme-modal-backdrop"
          isDismissable={!syncingDingTalk && !saving}
        >
          <Modal.Container placement="center" size="lg">
            <Modal.Dialog className="max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--color-bg-surface)]">
              <Modal.Header>
                <Modal.Heading>同步钉钉组织与用户</Modal.Heading>
                <Modal.CloseTrigger
                  aria-label="关闭"
                  isDisabled={syncingDingTalk || saving}
                />
              </Modal.Header>
              <Modal.Body className="space-y-6">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="App ID">
                    <Input
                      fullWidth
                      value={form.dingtalk.appId}
                      disabled={loading || saving || syncingDingTalk}
                      onChange={(event) =>
                        updateDingTalk("appId", event.currentTarget.value)
                      }
                    />
                  </Field>
                  <Field label="原企业内部应用 AgentId">
                    <Input
                      fullWidth
                      value={form.dingtalk.agentId}
                      disabled={loading || saving || syncingDingTalk}
                      onChange={(event) =>
                        updateDingTalk("agentId", event.currentTarget.value)
                      }
                    />
                  </Field>
                  <Field label="Client ID" hint="原 AppKey 和 SuiteKey">
                    <Input
                      fullWidth
                      value={form.dingtalk.clientId}
                      disabled={loading || saving || syncingDingTalk}
                      onChange={(event) =>
                        updateDingTalk("clientId", event.currentTarget.value)
                      }
                    />
                  </Field>
                  <Field
                    label="Client Secret"
                    hint="原 AppSecret 和 SuiteSecret"
                  >
                    <Input
                      fullWidth
                      type="password"
                      value={form.dingtalk.clientSecret}
                      disabled={loading || saving || syncingDingTalk}
                      onChange={(event) =>
                        updateDingTalk(
                          "clientSecret",
                          event.currentTarget.value,
                        )
                      }
                    />
                  </Field>
                </div>
                <Field label="AccessToken">
                  <div className="flex gap-2">
                    <Input
                      fullWidth
                      value={form.dingtalk.accessToken}
                      readOnly
                      placeholder="尚未获取"
                    />
                    <Button
                      className="shrink-0"
                      isDisabled={
                        loading ||
                        saving ||
                        syncingDingTalk ||
                        fetchingToken ||
                        !canFetchAccessToken
                      }
                      onPress={() => void fetchAccessToken()}
                    >
                      {fetchingToken ? "正在获取…" : "获取 AccessToken"}
                    </Button>
                  </div>
                </Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <ToggleRow
                    label="自动同步通讯录"
                    description="默认每 12 小时更新一次部门和用户。"
                    checked={form.dingtalk.syncEnabled}
                    disabled={loading || saving || syncingDingTalk}
                    onChange={(checked) =>
                      updateDingTalk("syncEnabled", checked)
                    }
                  />
                  <ToggleRow
                    label="包含所有子部门"
                    description="同步组织下的全部下级部门。"
                    checked={form.dingtalk.includeChildDepartments}
                    disabled={loading || saving || syncingDingTalk}
                    onChange={(checked) =>
                      updateDingTalk("includeChildDepartments", checked)
                    }
                  />
                  <ToggleRow
                    label="自动停用离职用户"
                    description="钉钉用户离职后禁止登录但保留业务数据。"
                    checked={form.dingtalk.disableDepartedUsers}
                    disabled={loading || saving || syncingDingTalk}
                    onChange={(checked) =>
                      updateDingTalk("disableDepartedUsers", checked)
                    }
                  />
                  <ToggleRow
                    label="登录时自动创建用户"
                    description="未同步用户首次登录时自动建立平台用户。"
                    checked={form.dingtalk.allowJitProvisioning}
                    disabled={loading || saving || syncingDingTalk}
                    onChange={(checked) =>
                      updateDingTalk("allowJitProvisioning", checked)
                    }
                  />
                </div>
                <div className="max-w-xs">
                  <Field label="同步周期（小时）">
                    <Input
                      fullWidth
                      type="number"
                      min="1"
                      max="168"
                      value={String(
                        Math.max(1, form.dingtalk.syncIntervalMinutes / 60),
                      )}
                      disabled={loading || saving || syncingDingTalk}
                      onChange={(event) =>
                        updateDingTalk(
                          "syncIntervalMinutes",
                          Number(event.currentTarget.value) * 60,
                        )
                      }
                    />
                  </Field>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="ghost"
                  isDisabled={saving || syncingDingTalk}
                  onPress={() => setSyncConfigOpen(false)}
                >
                  取消
                </Button>
                <Button
                  variant="primary"
                  isDisabled={
                    loading || saving || syncingDingTalk || !canFetchAccessToken
                  }
                  onPress={() =>
                    void (async () => {
                      if (await syncDingTalk()) setSyncConfigOpen(false);
                    })()
                  }
                >
                  {syncingDingTalk ? "正在保存并同步…" : "保存并同步"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal
        isOpen={clearConfirmOpen}
        onOpenChange={(open) => !clearingDingTalk && setClearConfirmOpen(open)}
      >
        <Modal.Backdrop
          className="theme-modal-backdrop"
          isDismissable={!clearingDingTalk}
        >
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog className="rounded-2xl bg-[var(--color-bg-surface)]">
              <Modal.Header>
                <Modal.Heading>清除钉钉同步数据</Modal.Heading>
                <Modal.CloseTrigger
                  aria-label="关闭"
                  isDisabled={clearingDingTalk}
                />
              </Modal.Header>
              <Modal.Body>
                <p className="">
                  确认清除所有钉钉来源的组织架构、用户、角色及角色权限配置吗？此操作不可恢复，不会删除钉钉应用凭据。
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="ghost"
                  isDisabled={clearingDingTalk}
                  onPress={() => setClearConfirmOpen(false)}
                >
                  取消
                </Button>
                <Button
                  className="bg-[var(--color-danger)] text-white"
                  isDisabled={clearingDingTalk}
                  onPress={() => void clearDingTalkData()}
                >
                  {clearingDingTalk ? "正在清除…" : "确认清除"}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </SettingsContentCard>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Switch
      isSelected={checked}
      isDisabled={disabled}
      onChange={onChange}
      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-control-soft)] p-4"
    >
      <Switch.Content className="w-full items-center justify-between">
        <span>
          <span className="block text-sm font-medium text-[var(--color-text-primary)]">
            {label}
          </span>
          <span className="mt-1 block text-xs leading-5 text-[var(--color-text-secondary)]">
            {description}
          </span>
        </span>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}

function ProviderPlaceholder({ name }: { name: string }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-6 text-center">
      <div className="text-base font-semibold text-[var(--color-text-primary)]">
        {name}身份源
      </div>
      <p className="mt-2 max-w-md ">
        Tab
        和配置扩展位置已经预留，后续接入时可以复用当前身份源接口与统一用户映射模型。
      </p>
      <span className="mt-4 rounded-full bg-[var(--color-warning-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--color-warning)]">
        待接入
      </span>
    </div>
  );
}
