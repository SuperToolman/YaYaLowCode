"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, Switch, toast } from "@heroui/react";
import { openLicenseManagementModal } from "@components/LicenseManagementModal";
import { SettingsContentCard } from "../components/SettingsContentCard";
import {
  getCommunicationSettings,
  getCommunicationStats,
  cleanupCommunication,
  updateCommunicationSettings,
} from "@features/settings/api";

type CommunicationModuleSettings = {
  installed: boolean;
  licenseId: string | null;
  expiresAt: number | null;
  maxFileUploadMb: number;
  retentionDays: number;
  allowedFileExtensions: string;
  websocketEnabled: boolean;
  allowFileMessages: boolean;
};
type StorageStats = {
  conversationCount: number;
  messageCount: number;
  attachmentCount: number;
  messageBytes: number;
  attachmentBytes: number;
  totalBytes: number;
};

const defaultSettings: CommunicationModuleSettings = {
  installed: false,
  licenseId: null,
  expiresAt: null,
  maxFileUploadMb: 20,
  retentionDays: 0,
  allowedFileExtensions: "",
  websocketEnabled: true,
  allowFileMessages: true,
};
function normalizeSettings(
  settings: Partial<CommunicationModuleSettings>,
): CommunicationModuleSettings {
  return { ...defaultSettings, ...settings };
}
function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export default function CommunicationSettingsPage() {
  const [settings, setSettings] =
    useState<CommunicationModuleSettings>(defaultSettings);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);

  async function load() {
    try {
      const nextSettings = normalizeSettings(
        await getCommunicationSettings<CommunicationModuleSettings>(),
      );
      setSettings(nextSettings);
      if (nextSettings.installed) {
        setStats(await getCommunicationStats<StorageStats>());
      }
    } catch (error) {
      toast.danger("无法加载通讯模块设置", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function save() {
    setSaving(true);
    try {
      setSettings(
        normalizeSettings(await updateCommunicationSettings(settings)),
      );
      toast.success("通讯模块设置已保存");
    } catch (error) {
      toast.danger("保存失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setSaving(false);
    }
  }
  async function cleanup() {
    setCleaning(true);
    try {
      const result = await cleanupCommunication<{
        deletedMessages: number;
        deletedFiles: number;
      }>();
      toast.success("过期通讯数据已清理", {
        description: `消息 ${result.deletedMessages} 条，附件 ${result.deletedFiles} 个`,
      });
      setCleanupConfirmOpen(false);
      await load();
    } catch (error) {
      toast.danger("清理失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setCleaning(false);
    }
  }
  const installed = settings.installed;
  return (
    <section className="h-full min-h-0">
      <SettingsContentCard
        title="通讯设置"
        subtitle="配置聊天附件、数据保留和实时通信策略。"
        footer={
          installed ? (
            <>
              <span className="text-xs text-[var(--color-text-secondary)]">
                修改后立即生效
              </span>
              <Button
                isDisabled={saving || loading}
                onPress={() => void save()}
              >
                {saving ? "正在保存…" : "保存配置"}
              </Button>
            </>
          ) : null
        }
      >
        {!installed ? (
          <div className="space-y-3 rounded-md bg-[var(--color-bg-subtle)] px-3 py-3 text-sm text-[var(--color-text-secondary)]">
            <p>当前平台许可证不包含通讯模块。请先激活 communication 模块。</p>
            <Button
              size="sm"
              variant="secondary"
              onPress={openLicenseManagementModal}
            >
              更新签名
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-[var(--color-success-soft)] px-3 py-3 text-sm text-[var(--color-success)]">
              <div>
                <p className="font-medium">通讯模块已安装</p>
                <p className="mt-1 text-xs">
                  许可证：{settings.licenseId || "未提供"}
                  {settings.expiresAt
                    ? ` · 有效期至 ${new Date(settings.expiresAt * 1000).toLocaleDateString("zh-CN")}`
                    : ""}
                </p>
              </div>
              <span className="text-xs">{loading ? "正在加载" : "运行中"}</span>
            </div>
            <section>
              <h3 className="text-sm font-semibold">存储概览</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Stat
                  label="聊天数据"
                  value={formatBytes(stats?.totalBytes ?? 0)}
                />
                <Stat label="消息" value={`${stats?.messageCount ?? 0} 条`} />
                <Stat
                  label="附件"
                  value={`${stats?.attachmentCount ?? 0} 个`}
                />
              </div>
              <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                消息内容 {formatBytes(stats?.messageBytes ?? 0)}，附件{" "}
                {formatBytes(stats?.attachmentBytes ?? 0)}，会话{" "}
                {stats?.conversationCount ?? 0} 个。
              </p>
            </section>
            <section className="border-t border-[var(--color-border)] pt-5">
              <h3 className="text-sm font-semibold">消息与附件</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm">
                  单个聊天文件最大大小
                  <Input
                    className="mt-2"
                    type="number"
                    min="1"
                    max="200"
                    value={String(settings.maxFileUploadMb)}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        maxFileUploadMb: Number(event.currentTarget.value) || 1,
                      })
                    }
                  />
                  <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">
                    单位：MB，范围 1 至 200。
                  </span>
                </label>
                <label className="text-sm">
                  允许的文件类型
                  <Input
                    className="mt-2"
                    placeholder="例如 pdf,docx,png"
                    value={settings.allowedFileExtensions}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        allowedFileExtensions: event.currentTarget.value,
                      })
                    }
                  />
                  <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">
                    留空表示不限制扩展名。
                  </span>
                </label>
              </div>
              <Switch
                className="mt-4"
                isSelected={settings.allowFileMessages}
                onChange={(value) =>
                  setSettings({ ...settings, allowFileMessages: value })
                }
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  允许发送聊天文件
                </Switch.Content>
              </Switch>
            </section>
            <section className="border-t border-[var(--color-border)] pt-5">
              <h3 className="text-sm font-semibold">数据保留与实时通信</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm">
                  消息保留天数
                  <Input
                    className="mt-2"
                    type="number"
                    min="0"
                    max="3650"
                    value={String(settings.retentionDays)}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        retentionDays: Math.max(
                          0,
                          Number(event.currentTarget.value) || 0,
                        ),
                      })
                    }
                  />
                  <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">
                    0 表示永久保留。
                  </span>
                </label>
                <div className="flex items-end">
                  <Button
                    variant="secondary"
                    isDisabled={cleaning || settings.retentionDays === 0}
                    onPress={() => setCleanupConfirmOpen(true)}
                  >
                    {cleaning ? "清理中…" : "清理过期数据"}
                  </Button>
                </div>
              </div>
              <Switch
                className="mt-4"
                isSelected={settings.websocketEnabled}
                onChange={(value) =>
                  setSettings({ ...settings, websocketEnabled: value })
                }
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  启用 WebSocket 实时推送
                </Switch.Content>
              </Switch>
            </section>
          </div>
        )}
        <Modal
          isOpen={cleanupConfirmOpen}
          onOpenChange={(open) => !cleaning && setCleanupConfirmOpen(open)}
        >
          <Modal.Backdrop
            className="theme-modal-backdrop"
            isDismissable={!cleaning}
          >
            <Modal.Container placement="center" size="sm">
              <Modal.Dialog className="rounded-2xl bg-[var(--color-bg-surface)]">
                <Modal.Header>
                  <Modal.Heading>清理过期聊天数据</Modal.Heading>
                  <Modal.CloseTrigger aria-label="关闭" isDisabled={cleaning} />
                </Modal.Header>
                <Modal.Body>
                  <p className="">
                    将删除超过 {settings.retentionDays}{" "}
                    天的聊天消息，并移除不再被任何聊天消息引用的附件。此操作不可恢复。
                  </p>
                </Modal.Body>
                <Modal.Footer>
                  <Button
                    variant="ghost"
                    isDisabled={cleaning}
                    onPress={() => setCleanupConfirmOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    className="bg-[var(--color-danger)] text-white"
                    isDisabled={cleaning}
                    onPress={() => void cleanup()}
                  >
                    {cleaning ? "清理中…" : "确认清理"}
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      </SettingsContentCard>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-control-soft)] p-3">
      <p className="text-xs text-[var(--color-text-secondary)]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
        {value}
      </p>
    </div>
  );
}
