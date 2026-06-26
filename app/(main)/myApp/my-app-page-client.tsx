"use client";

import type { ReactNode } from "react";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Dropdown, Input } from "@heroui/react";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Modal } from "@heroui/react/modal";
import {
  ArrowRight,
  Calendar,
  CircleCheck,
  CircleMinus,
  Ellipsis,
  Clock,
  Funnel,
  LayoutHeaderCellsLarge,
  LayoutList,
  Magnifier,
  Plus,
  Rocket,
  Sliders,
} from "@gravity-ui/icons";
import { createApp, listApps, type App as ApiApp } from "../../lib/api-client";
import { AppIcon } from "../../components/app-icons";
import { appStatusLabel, appStatusTone, type AppItem, type AppStatus } from "../../lib/apps";
import { PlatformHeader } from "../components/platform-header";

const statusOrder: AppStatus[] = ["enabled", "paused", "draft"];

type MyAppPageClientProps = {
  initialApps: AppItem[];
};

export function MyAppPageClient({ initialApps }: MyAppPageClientProps) {
  const [apps, setApps] = useState(sortApps(initialApps.map(normalizeAppItem)));
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState("");
  const [busyAppId, setBusyAppId] = useState<string | null>(null);
  const [renameApp, setRenameApp] = useState<AppItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteApp, setDeleteApp] = useState<AppItem | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    startTransition(async () => {
      try {
        const { data, error } = await listApps({
          responseStyle: "fields",
        });

        if (error || !data || data.code !== 0 || !data.data) {
          throw new Error("load apps failed");
        }

        if (!cancelled && data.data.length > 0) {
          setApps(sortApps(data.data.map(toAppItem).map(normalizeAppItem)));
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("后端暂不可用，当前展示本地演示数据。");
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const enabledCount = apps.filter((app) => app.status === "enabled").length;
  const totalRecords = apps.reduce((total, app) => total + app.records, 0);
  const appGroups = [
    { label: "全部应用", count: apps.length, active: true },
    { label: "我创建的", count: Math.max(1, Math.ceil(apps.length / 2)) },
    { label: "我参与的", count: Math.max(1, apps.length - 1) },
    { label: "近期访问", count: Math.min(5, apps.length) },
    { label: "已收藏", count: Math.min(4, apps.length) },
  ];
  const statusTabs = [
    { label: "全部", count: apps.length },
    {
      label: "已启用",
      count: apps.filter((app) => app.status === "enabled").length,
    },
    {
      label: "已关闭",
      count: apps.filter((app) => app.status === "paused").length,
    },
  ];

  async function handleCreateApp() {
    setErrorMessage("");

    startTransition(async () => {
      try {
        const { data, error } = await createApp({
          body: {},
          responseStyle: "fields",
        });

        if (error || !data || data.code !== 0 || !data.data) {
          throw new Error("create app failed");
        }

        const createdApp = toAppItem(data.data);
        setApps((current) => sortApps([normalizeAppItem(createdApp), ...current]));
        router.push(`/${createdApp.id}`);
      } catch {
        setErrorMessage("创建应用失败，请确认 Rust API 和 PostgreSQL 已启动。");
      }
    });
  }

  async function handleToggleApp(app: AppItem) {
    setErrorMessage("");
    setBusyAppId(app.id);

    try {
      const nextStatus = app.status === "enabled" ? "paused" : "enabled";
      const response = await fetch(`/api/apps/${app.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = (await response.json()) as {
        code: number;
        data: ApiApp | null;
        message: string;
      };

      if (payload.code !== 0 || !payload.data) {
        throw new Error(payload.message);
      }

      const updatedApp = normalizeAppItem(toAppItem(payload.data));
      setApps((current) =>
        sortApps(current.map((item) => (item.id === app.id ? updatedApp : item))),
      );
    } catch {
      setErrorMessage("更新应用状态失败。");
    } finally {
      setBusyAppId(null);
    }
  }

  async function handleRenameApp(app: AppItem) {
    const nextName = renameValue.trim();

    if (!nextName || nextName === app.name) {
      setRenameApp(null);
      return;
    }

    setErrorMessage("");
    setBusyAppId(app.id);

    try {
      const response = await fetch(`/api/apps/${app.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: nextName }),
      });
      const payload = (await response.json()) as {
        code: number;
        data: ApiApp | null;
        message: string;
      };

      if (payload.code !== 0 || !payload.data) {
        throw new Error(payload.message);
      }

      const updatedApp = normalizeAppItem(toAppItem(payload.data));
      setApps((current) =>
        sortApps(current.map((item) => (item.id === app.id ? updatedApp : item))),
      );
      setRenameApp(null);
    } catch {
      setErrorMessage("更新应用名称失败。");
    } finally {
      setBusyAppId(null);
    }
  }

  async function handleDeleteApp(app: AppItem) {
    setErrorMessage("");
    setBusyAppId(app.id);

    try {
      const response = await fetch(`/api/apps/${app.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as {
        code: number;
        message: string;
      };

      if (payload.code !== 0) {
        throw new Error(payload.message);
      }

      setApps((current) => current.filter((item) => item.id !== app.id));
      setDeleteApp(null);
    } catch {
      setErrorMessage("删除应用失败。");
    } finally {
      setBusyAppId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-[#14213d]">
      <PlatformHeader active="apps" />
      <main className="mx-auto grid max-w-[1440px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-[84px] space-y-4">
            <section className="rounded-lg border border-[#dfe7f3] bg-white p-4 shadow-[0_10px_30px_rgba(20,33,61,0.05)]">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">应用分组</h2>
                <Funnel className="h-4 w-4 text-[#7587a3]" />
              </div>
              <div className="mt-3 space-y-1">
                {appGroups.map((group) => (
                  <Button
                    key={group.label}
                    variant="ghost"
                    className={[
                      "flex h-10 w-full items-center justify-between rounded-lg px-3 text-sm transition-colors",
                      group.active
                        ? "bg-[#edf4ff] font-medium text-[#2f6bff]"
                        : "text-[#4f6484] hover:bg-[#f6f9fe] hover:text-[#14213d]",
                    ].join(" ")}
                  >
                    <span>{group.label}</span>
                    <span>{group.count}</span>
                  </Button>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-[#dfe7f3] bg-white p-4 shadow-[0_10px_30px_rgba(20,33,61,0.05)]">
              <h2 className="text-sm font-semibold">状态统计</h2>
              <div className="mt-4 space-y-3">
                <StatusLine
                  icon={<CircleCheck />}
                  label="已启用"
                  value={`${enabledCount} 个`}
                  color="text-[#17a25b]"
                />
                <StatusLine
                  icon={<CircleMinus />}
                  label="已关闭"
                  value={`${apps.filter((app) => app.status === "paused").length} 个`}
                  color="text-[#6d7f9a]"
                />
              </div>
            </section>
          </div>
        </aside>

        <section className="min-w-0 space-y-5">
          <section className="rounded-lg border border-[#d9e5f5] bg-white p-5 shadow-[0_16px_40px_rgba(20,33,61,0.06)]">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-sm font-medium text-[#4f6484]">
                  应用管理中心
                </p>
                <h1 className="mt-2 text-3xl font-semibold leading-tight text-[#14213d] sm:text-4xl">
                  我的应用
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5f718e]">
                  管理企业低代码应用、表单入口、运行状态和数据规模。
                </p>
                {errorMessage ? (
                  <Alert className="mt-3" status="danger">
                    <Alert.Content>
                      <Alert.Title>操作失败</Alert.Title>
                      <Alert.Description>{errorMessage}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handleCreateApp}
                  isDisabled={isPending}
                  className="h-10 gap-2 rounded-lg bg-[#2f6bff] px-4 text-sm font-medium text-white"
                >
                  <Plus className="h-4 w-4" />
                  {isPending ? "创建中..." : "创建应用"}
                </Button>
                <Button
                  variant="ghost"
                  className="h-10 gap-2 rounded-lg border border-[#d7e2f1] bg-white px-4 text-sm font-medium text-[#263a5c]"
                >
                  <Rocket className="h-4 w-4" />
                  导入应用
                </Button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="全部应用" value={apps.length} suffix="个" />
              <Metric label="运行中" value={enabledCount} suffix="个" tone="text-[#17a25b]" />
              <Metric label="数据记录" value={totalRecords} suffix="条" tone="text-[#b4237a]" />
              <Metric
                label="本次会话新增"
                value={Math.max(0, apps.length - initialApps.length)}
                suffix="个"
                tone="text-[#d97706]"
              />
            </div>
          </section>

          <section className="rounded-lg border border-[#dfe7f3] bg-white p-4 shadow-[0_10px_30px_rgba(20,33,61,0.05)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-2">
                {statusTabs.map((tab, index) => (
                  <Button
                    key={tab.label}
                    variant="ghost"
                    className={[
                      "h-9 rounded-lg px-3 text-sm font-medium transition-colors",
                      index === 0
                        ? "bg-[#edf4ff] text-[#2f6bff]"
                        : "text-[#4f6484] hover:bg-[#f6f9fe] hover:text-[#14213d]",
                    ].join(" ")}
                  >
                    {tab.label}
                    <span className="ml-2 text-xs opacity-75">{tab.count}</span>
                  </Button>
                ))}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex h-10 min-w-[260px] items-center gap-2 rounded-lg border border-[#dfe7f3] bg-[#f7faff] px-3">
                  <Magnifier className="h-4 w-4 shrink-0 text-[#7587a3]" />
                  <Input
                    aria-label="搜索应用"
                    className="flex-1"
                    placeholder="搜索应用名称或负责人"
                  />
                </div>
                <Button
                  variant="ghost"
                  className="h-10 gap-2 rounded-lg border border-[#d7e2f1] bg-white px-3 text-sm font-medium text-[#4f6484]"
                >
                  <Sliders className="h-4 w-4" />
                  筛选
                </Button>
                <div className="flex h-10 rounded-lg border border-[#d7e2f1] bg-white p-1">
                  <Button
                    aria-label="卡片视图"
                    variant="ghost"
                    className="flex h-8 w-8 min-w-8 items-center justify-center rounded-md bg-[#edf4ff] p-0 text-[#2f6bff]"
                  >
                    <LayoutHeaderCellsLarge className="h-4 w-4" />
                  </Button>
                  <Button
                    aria-label="列表视图"
                    variant="ghost"
                    className="flex h-8 w-8 min-w-8 items-center justify-center rounded-md p-0 text-[#7587a3]"
                  >
                    <LayoutList className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            {sortApps(apps).map((app) => (
              <article
                key={app.id}
                className="rounded-lg border border-[#dfe7f3] bg-white p-4 shadow-[0_10px_30px_rgba(20,33,61,0.05)] transition-colors hover:border-[#aac5ff]"
              >
                <div className="flex items-start gap-4">
                  <span
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${app.color}`}
                  >
                    <AppIcon type={app.icon} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <h2 className="truncate text-base font-semibold">
                            {app.name}
                          </h2>
                          {app.badge ? (
                            <span className="shrink-0 rounded-md bg-[#fff0f3] px-2 py-0.5 text-xs font-medium text-[#c73655]">
                              {app.badge}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#60718a]">
                          {app.desc}
                        </p>
                      </div>
                      <Dropdown>
                        <Dropdown.Trigger>
                          <span
                            aria-label={`${app.name} 更多操作`}
                            className="inline-flex h-8 w-8 min-w-8 shrink-0 items-center justify-center rounded-lg p-0 text-[#7587a3]"
                          >
                            <Ellipsis className="h-4 w-4" />
                          </span>
                        </Dropdown.Trigger>
                        <Dropdown.Popover>
                          <Dropdown.Menu
                            aria-label={`${app.name} 操作菜单`}
                            className="min-w-[160px]"
                          >
                            <Dropdown.Item
                              id="toggle"
                              isDisabled={busyAppId === app.id}
                              onAction={() => void handleToggleApp(app)}
                            >
                              {app.status === "enabled" ? "关闭" : "启动"}
                            </Dropdown.Item>
                            <Dropdown.Item
                              id="rename"
                              isDisabled={busyAppId === app.id}
                              onAction={() => {
                                setRenameApp(app);
                                setRenameValue(app.name);
                              }}
                            >
                              编辑名称
                            </Dropdown.Item>
                            <Dropdown.Item id="settings" isDisabled>
                              应用设置
                            </Dropdown.Item>
                            <Dropdown.Item
                              id="delete"
                              isDisabled={busyAppId === app.id}
                              className="text-[#c73655]"
                              onAction={() => setDeleteApp(app)}
                            >
                              删除应用
                            </Dropdown.Item>
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-medium ${appStatusTone[app.status]}`}
                      >
                        {appStatusLabel[app.status]}
                      </span>
                      <InfoPill icon={<Calendar />} text={app.createdAt} />
                      <InfoPill icon={<Clock />} text={`${app.records} 条数据`} />
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 border-t border-[#edf2f8] pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm text-[#7587a3]">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#17324f] text-xs font-semibold text-white">
                      {app.owner.slice(0, 1)}
                    </span>
                    <span>{app.owner}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/${app.id}`}
                      className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2f6bff] px-3 text-sm font-medium text-white transition-colors hover:bg-[#245be6]"
                    >
                      访问
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </section>
        </section>
      </main>

      <Modal isOpen={renameApp !== null} onOpenChange={(isOpen) => !isOpen && setRenameApp(null)}>
        <Modal.Backdrop className="bg-[#14213d]/20" isDismissable>
          <Modal.Container placement="center" size="md">
            <Modal.Dialog className="rounded-2xl bg-white text-[#202f45] shadow-[0_30px_90px_rgba(20,33,61,0.24)]">
              <Modal.Header className="border-b border-[#eef2f7] px-5 py-4">
                <Modal.Heading className="text-lg font-semibold text-[#14213d]">
                  编辑应用名称
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="px-5 py-4">
                <Input
                  aria-label="应用名称"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.currentTarget.value)}
                  placeholder="请输入应用名称"
                />
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-3 border-t border-[#eef2f7] px-5 py-3">
                <Button variant="ghost" onPress={() => setRenameApp(null)}>
                  取消
                </Button>
                <Button
                  isDisabled={!renameApp || busyAppId === renameApp.id}
                  onPress={() => renameApp && void handleRenameApp(renameApp)}
                >
                  保存
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <AlertDialog isOpen={deleteApp !== null} onOpenChange={(isOpen) => !isOpen && setDeleteApp(null)}>
        <AlertDialog.Backdrop className="bg-[#14213d]/20" />
        <AlertDialog.Container placement="center" size="md">
          <AlertDialog.Dialog className="rounded-2xl bg-white text-[#202f45] shadow-[0_30px_90px_rgba(20,33,61,0.24)]">
            <AlertDialog.Header className="border-b border-[#eef2f7] px-5 py-4">
              <AlertDialog.Heading className="text-lg font-semibold text-[#14213d]">
                删除应用
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="px-5 py-4 text-sm leading-6 text-[#5f718e]">
              {deleteApp
                ? `确认删除应用“${deleteApp.name}”吗？这会同时删除该应用下的表单、版本和导航数据。`
                : ""}
            </AlertDialog.Body>
            <AlertDialog.Footer className="flex justify-end gap-3 border-t border-[#eef2f7] px-5 py-3">
              <Button variant="ghost" onPress={() => setDeleteApp(null)}>
                取消
              </Button>
              <Button
                className="bg-[#c73655] text-white"
                isDisabled={!deleteApp || busyAppId === deleteApp.id}
                onPress={() => deleteApp && void handleDeleteApp(deleteApp)}
              >
                删除
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog>
    </div>
  );
}

function sortApps(items: AppItem[]) {
  return [...items].sort((left, right) => {
    const statusDelta =
      statusOrder.indexOf(left.status) - statusOrder.indexOf(right.status);

    if (statusDelta !== 0) {
      return statusDelta;
    }

    return right.createdAt.localeCompare(left.createdAt);
  });
}

function toAppItem(app: ApiApp): AppItem {
  return {
    ...app,
    badge: app.badge ?? undefined,
  };
}

function normalizeAppItem(app: AppItem): AppItem {
  if (app.status !== "draft") {
    return app;
  }

  return {
    ...app,
    status: "paused",
  };
}

function StatusLine({
  color,
  icon,
  label,
  value,
}: {
  color: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="flex min-w-0 items-center gap-2 text-[#4f6484]">
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center ${color} [&>svg]:h-4 [&>svg]:w-4`}>
          {icon}
        </span>
        {label}
      </span>
      <span className="font-medium text-[#14213d]">{value}</span>
    </div>
  );
}

function Metric({
  label,
  suffix,
  tone = "text-[#2f6bff]",
  value,
}: {
  label: string;
  suffix: string;
  tone?: string;
  value: number;
}) {
  return (
    <article className="rounded-lg border border-[#e3ebf6] bg-[#fbfdff] p-4">
      <p className="text-sm text-[#7587a3]">{label}</p>
      <div className="mt-2 flex items-end gap-1">
        <strong className={`text-3xl font-semibold ${tone}`}>
          {value.toLocaleString()}
        </strong>
        <span className="pb-1 text-sm text-[#7587a3]">{suffix}</span>
      </div>
    </article>
  );
}

function InfoPill({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[#f4f7fb] px-2 py-1 text-xs text-[#60718a]">
      <span className="flex h-3.5 w-3.5 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5">
        {icon}
      </span>
      {text}
    </span>
  );
}
