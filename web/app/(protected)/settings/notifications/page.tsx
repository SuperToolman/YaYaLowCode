"use client";
import { notifyRequestError } from "@lib/notify";
import { useAuth } from "@components/AuthProvider";

import { useEffect, useState } from "react";
import { Button, Input, Surface, Switch } from "@heroui/react";
import { notify } from "@lib/notify";
import { isRequestAborted, unwrapApiResult } from "@lib/api-request";
import { getNotificationSettings, updateNotificationSettings } from "@lib/http";
import { Field } from "../components/Field";
import { SettingsContentCard } from "../components/SettingsContentCard";

type NotificationSettings = import("@lib/http").NotificationSettings;

export default function NotificationSettingsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("settings.notifications.manage");
  const [form, setForm] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const settings = await getNotificationSettings({
          cache: "no-store",
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setForm(unwrapApiResult(settings));
      } catch (error) {
        if (!controller.signal.aborted && !isRequestAborted(error)) {
          notifyRequestError(error, "无法加载通知设置", {
            description: error instanceof Error ? error.message : "请稍后重试。",
          });
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  const intervalValid = form != null
    && Number.isInteger(form.pollIntervalSeconds)
    && (form.pollIntervalSeconds ?? 60) >= 15
    && (form.pollIntervalSeconds ?? 60) <= 3600;
  const disabled = !canManage || loading || saving || !form;

  async function save() {
    if (!form || !intervalValid || saving) return;
    setSaving(true);
    try {
      // Preserve stored fields outside this page's editable settings.
      const settings = unwrapApiResult(await updateNotificationSettings({ body: form }));
      setForm(settings);
      notify.success("通知设置已保存");
    } catch (error) {
      notifyRequestError(error, "保存失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="h-full min-h-0">
      <SettingsContentCard
        title="通知设置"
        subtitle="流程待办与抄送通知"
      >
        <Surface className="flex max-w-2xl flex-col gap-5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="m-0 text-sm font-semibold">站内流程通知</h3>
              <p className="mt-1 text-sm text-muted">
                收到新的流程待办或抄送时，在站内显示通知。
              </p>
            </div>
            <Switch
              aria-label="启用站内流程通知"
              isSelected={form?.inAppEnabled ?? false}
              isDisabled={disabled}
              onChange={(value) => setForm((current) => current ? { ...current, inAppEnabled: value } : current)}
            >
              <Switch.Content>
                <Switch.Control><Switch.Thumb /></Switch.Control>
                启用通知
              </Switch.Content>
            </Switch>
          </div>

          <div className="max-w-xs">
            <Field label="轮询间隔（秒）" hint="每隔多久检查新通知，允许 15 至 3600 秒。">
              <Input
                aria-label="轮询间隔（秒）"
                type="number"
                min={15}
                max={3600}
                step={1}
                value={form ? String(form.pollIntervalSeconds) : ""}
                disabled={disabled || !form?.inAppEnabled}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  setForm((current) => current ? { ...current, pollIntervalSeconds: value } : current);
                }}
              />
            </Field>
            {form && !intervalValid ? (
              <p role="alert" className="mt-2 text-xs text-danger">请输入 15 至 3600 的整数。</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-xs text-muted">
              {loading ? "正在加载通知设置…" : !form
                ? "加载失败，请刷新页面后重试。"
                : form.inAppEnabled
                  ? "关闭后将停止生成新的流程通知，已有通知仍保留。"
                  : "通知已关闭，保存后生效。"}
            </p>
            <Button isDisabled={!canManage || disabled || !intervalValid} onPress={() => void save()}>
              {saving ? "正在保存…" : "保存设置"}
            </Button>
          </div>
        </Surface>
      </SettingsContentCard>
    </section>
  );
}
