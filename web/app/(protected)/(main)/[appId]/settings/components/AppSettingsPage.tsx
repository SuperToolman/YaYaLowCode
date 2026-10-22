"use client";
import { assertApiResult } from "@lib/api-request";

import { notifyRequestError } from "@lib/notify";

import { notify } from "@lib/notify";
import { use, useEffect, useState, type Key } from "react";
import {
  Button,
  Card,
  Description,
  Input,
  Label,
  ListBox,
  Select,
  TextArea,
  TextField,
  Typography,
} from "@heroui/react";
import { AppSettingsLayout } from "./AppSettingsLayout";
import { setDefaultNavigationEntry, updateApp } from "@/features/application/api";
import {
  getAppForms,
  getAppNavigation,
  getAppResource,
  invalidateAppResources,
} from "@lib/app-resources";

type FormSettingsItem = { id: string; name: string };
const SYSTEM_PAGE_PREFIX = "system:";
const systemPageOptions = [{ slug: "tasks", name: "任务" }];

export default function AppSettingsPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = use(params);
  const [appName, setAppName] = useState("");
  const [appDescription, setAppDescription] = useState("");
  const [forms, setForms] = useState<FormSettingsItem[]>([]);
  const [defaultEntryKey, setDefaultEntryKey] = useState(
    `${SYSTEM_PAGE_PREFIX}tasks`,
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void getAppResource(appId)
      .then((app) => {
        if (!cancelled) {
          setAppName(app.name);
          setAppDescription(app.desc ?? "");
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [appId]);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([getAppForms(appId), getAppNavigation(appId)])
      .then(([nextForms, navigationItems]) => {
        if (cancelled) return;
        setForms(nextForms.map((form) => ({ id: form.id, name: form.name })));
        const defaultEntry = navigationItems.find(
          (item) => item.isDefaultEntry,
        );
        setDefaultEntryKey(
          defaultEntry?.itemType === "system"
            ? `${SYSTEM_PAGE_PREFIX}${defaultEntry.pathSlug}`
            : (defaultEntry?.targetFormUuid ?? `${SYSTEM_PAGE_PREFIX}tasks`),
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
      notify.error("请输入应用名称");
      return;
    }
    setIsSaving(true);
    try {
      const [appResult, navigationResult] = await Promise.all([
        updateApp({
          path: { appId },
          body: { name: nextName, description: appDescription.trim() },
          responseStyle: "fields",
        }),
        setDefaultNavigationEntry({
          path: { appId },
          body: defaultEntryKey.startsWith(SYSTEM_PAGE_PREFIX)
            ? {
                system_page_slug: defaultEntryKey.slice(
                  SYSTEM_PAGE_PREFIX.length,
                ),
              }
            : { form_uuid: defaultEntryKey },
          responseStyle: "fields",
        }),
      ]);
      assertApiResult(appResult);
      assertApiResult(navigationResult);
      const appPayload = appResult.data;
      invalidateAppResources(appId, ["app", "navigation"]);
      setAppName(appPayload.data?.name ?? nextName);
      setAppDescription(appPayload.data?.desc ?? appDescription.trim());
      notify.success("基础设置已保存", {
        description: "进入应用时将默认打开所选页面。",
      });
    } catch (error) {
      notifyRequestError(error, "保存失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppSettingsLayout appId={appId} appName={appName} selectedKey="basic">
      <main className="min-h-0 min-w-0">
        <Card className="h-full min-h-0">
          <Card.Header className="flex-wrap items-start justify-between gap-4 sm:flex-row">
            <div className="min-w-0">
              <Card.Title>基础设置</Card.Title>
              <Card.Description>维护应用的基础信息和默认展示方式。</Card.Description>
            </div>
            <Button isPending={isSaving} onPress={saveBasicSettings}>
              保存设置
            </Button>
          </Card.Header>
          <Card.Content className="min-h-0 overflow-y-auto overscroll-contain">
            <div className="flex flex-col gap-8">
              <section className="flex flex-col gap-4" aria-labelledby="app-info-heading">
                <div>
                  <Typography.Heading level={3} id="app-info-heading">应用信息</Typography.Heading>
                  <Typography.Paragraph size="sm" color="muted">设置应用名称、标识及说明。</Typography.Paragraph>
                </div>
                <div className="flex flex-col gap-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField
                      name="appName"
                      value={appName}
                      onChange={setAppName}
                      isRequired
                    >
                      <Label>应用名称</Label>
                      <Input placeholder="请输入应用名称" />
                    </TextField>
                    <TextField name="appId" value={appId} isReadOnly>
                      <Label>应用标识</Label>
                      <Input />
                    </TextField>
                  </div>
                  <TextField
                    name="appDescription"
                    value={appDescription}
                    onChange={setAppDescription}
                  >
                    <Label>应用说明</Label>
                    <TextArea rows={5} placeholder="描述应用用途（可选）" />
                  </TextField>
                </div>
              </section>

              <section className="flex flex-col gap-4" aria-labelledby="app-entry-heading">
                <div>
                  <Typography.Heading level={3} id="app-entry-heading">默认展示</Typography.Heading>
                  <Typography.Paragraph size="sm" color="muted">控制进入应用后的默认页面与导航行为。</Typography.Paragraph>
                </div>
                <div>
                  <Select
                    className="w-full max-w-md"
                    selectedKey={defaultEntryKey}
                    onSelectionChange={(key: Key | null) =>
                      setDefaultEntryKey(
                        key === null ? `${SYSTEM_PAGE_PREFIX}tasks` : String(key),
                      )
                    }
                  >
                    <Label>默认打开的页面</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Description>
                      成员从应用入口进入时，将打开所选系统页面或表单。默认打开任务。
                    </Description>
                    <Select.Popover>
                      <ListBox>
                        {systemPageOptions.map((page) => (
                          <ListBox.Item
                            key={page.slug}
                            id={`${SYSTEM_PAGE_PREFIX}${page.slug}`}
                            textValue={page.name}
                          >
                            {page.name}
                          </ListBox.Item>
                        ))}
                        {forms.map((form) => (
                          <ListBox.Item key={form.id} id={form.id} textValue={form.name}>
                            {form.name}
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </div>
              </section>
            </div>
          </Card.Content>
        </Card>
      </main>
    </AppSettingsLayout>
  );
}
