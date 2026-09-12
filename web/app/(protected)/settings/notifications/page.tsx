"use client";

import { useEffect, useState } from "react";
import { Button, Input, Surface, Switch, toast } from "@heroui/react";
import { isRequestAborted, jsonRequest, requestApi } from "../../../lib/api-request";
import { Field } from "../components/Field";
import { SettingsContentCard } from "../components/SettingsContentCard";
import styles from "./notifications.module.css";

type NotificationSettings = {
  inAppEnabled: boolean;
  pollIntervalSeconds: number;
  retentionDays: number;
  dingtalkEnabled: boolean;
  dingtalkWebhookUrl: string;
  emailEnabled: boolean;
  emailFromAddress: string;
  websocketEnabled: boolean;
};

const defaults: NotificationSettings = {
  inAppEnabled: true, pollIntervalSeconds: 60, retentionDays: 90,
  dingtalkEnabled: false, dingtalkWebhookUrl: "",
  emailEnabled: false, emailFromAddress: "", websocketEnabled: false,
};

export default function NotificationSettingsPage() {
  const [form, setForm] = useState<NotificationSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const settings = await requestApi<NotificationSettings>("/api/settings/notifications", {
          cache: "no-store",
          signal: controller.signal,
        });
        setForm(settings);
      } catch (error) {
        if (!controller.signal.aborted && !isRequestAborted(error)) {
          toast.danger("无法加载通知设置", { description: error instanceof Error ? error.message : "请稍后重试。" });
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const settings = await requestApi<NotificationSettings>("/api/settings/notifications", jsonRequest(form, { method: "PUT" }));
      setForm(settings);
      toast.success("通知设置已保存");
    } catch (error) {
      toast.danger("保存失败", { description: error instanceof Error ? error.message : "请稍后重试。" });
    } finally { setSaving(false); }
  }

  return <section className={styles.page}>
    <SettingsContentCard
      title="通知设置"
      subtitle="管理流程站内通知，并预先维护钉钉、邮件和 WebSocket 渠道的接入配置。"
      footer={<><p className={styles.footerNote}>外部渠道尚未接入投递器；保存配置不会向钉钉或邮箱发送任何消息。</p><Button isDisabled={loading || saving} onPress={() => void save()}>{saving ? "正在保存…" : "保存设置"}</Button></>}
    >
      <div className={styles.sections}>
        <Surface className={styles.card}>
          <h3 className={styles.heading}>站内通知</h3>
          <p className={styles.description}>流程待办和抄送会显示在导航栏用户头像菜单中。</p>
          <div className={styles.content}>
            <Switch isSelected={form.inAppEnabled} isDisabled={loading || saving} onChange={(value) => setForm({ ...form, inAppEnabled: value })}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>启用站内流程通知</Switch.Content></Switch>
            <div className={styles.grid}>
              <Field label="轮询间隔（秒）" hint="15 至 3600 秒。"><Input type="number" value={String(form.pollIntervalSeconds)} disabled={loading || saving} onChange={(event) => setForm({ ...form, pollIntervalSeconds: Number(event.currentTarget.value) || 0 })} /></Field>
              <Field label="保留天数" hint="用于后续清理已读历史通知。"><Input type="number" value={String(form.retentionDays)} disabled={loading || saving} onChange={(event) => setForm({ ...form, retentionDays: Number(event.currentTarget.value) || 0 })} /></Field>
            </div>
          </div>
        </Surface>

        <Surface className={styles.card}>
          <h3 className={styles.heading}>外部渠道预留</h3>
          <p className={styles.description}>渠道参数会安全保存，待投递器、重试和 Outbox 接入后才会实际生效。</p>
          <div className={styles.content}>
            <div className={styles.channel}><Switch isSelected={form.dingtalkEnabled} isDisabled={loading || saving} onChange={(value) => setForm({ ...form, dingtalkEnabled: value })}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>预启用钉钉通知</Switch.Content></Switch><Field label="钉钉机器人 Webhook"><Input type="url" value={form.dingtalkWebhookUrl} disabled={loading || saving} onChange={(event) => setForm({ ...form, dingtalkWebhookUrl: event.currentTarget.value })} placeholder="https://oapi.dingtalk.com/robot/send?..." /></Field></div>
            <div className={styles.channel}><Switch isSelected={form.emailEnabled} isDisabled={loading || saving} onChange={(value) => setForm({ ...form, emailEnabled: value })}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>预启用邮件通知</Switch.Content></Switch><Field label="发件人地址"><Input type="email" value={form.emailFromAddress} disabled={loading || saving} onChange={(event) => setForm({ ...form, emailFromAddress: event.currentTarget.value })} placeholder="no-reply@example.com" /></Field></div>
            <Switch isSelected={form.websocketEnabled} isDisabled={loading || saving} onChange={(value) => setForm({ ...form, websocketEnabled: value })}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>预启用 WebSocket 实时推送</Switch.Content></Switch>
          </div>
        </Surface>
      </div>
    </SettingsContentCard>
  </section>;
}

