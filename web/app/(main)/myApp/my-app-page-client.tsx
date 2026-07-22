"use client";

import type { ReactNode } from "react";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, Button, Card, Dropdown, Input } from "@heroui/react";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Modal } from "@heroui/react/modal";
import {
  ArrowRight,
  Calendar,
  Ellipsis,
  Clock,
  Funnel,
  Magnifier,
  Plus,
  Rocket,
} from "@gravity-ui/icons";
import { createApp, listApps, type App as ApiApp } from "../../lib/api-client";
import { AppIcon } from "../../components/app-icons";
import { PageHeader } from "../../components/page-header";
import { useAuth } from "../../components/auth-provider";
import {
  appColorToneClass,
  appStatusLabel,
  appStatusTone,
  normalizeAppColorTone,
  type AppItem,
  type AppStatus,
} from "../../lib/apps";
// import { PlatformHeader } from "../components/platform-header";

const statusOrder: AppStatus[] = ["enabled", "paused", "draft"];

type MyAppPageClientProps = {
  initialApps: AppItem[];
};

export function MyAppPageClient({ initialApps }: MyAppPageClientProps) {
  const [apps, setApps] = useState(sortApps(initialApps.map(normalizeAppItem)));
  const [isPending, startTransition] = useTransition();
  const [busyAppId, setBusyAppId] = useState<string | null>(null);
  const [renameApp, setRenameApp] = useState<AppItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteApp, setDeleteApp] = useState<AppItem | null>(null);
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canManageApps = hasPermission("apps.manage");
  const canImportApps = hasPermission("apps.import");

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
      } catch { }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const enabledCount = apps.filter((app) => app.status === "enabled").length;
  const pausedCount = apps.filter((app) => app.status === "paused").length;
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
      } catch { }
    });
  }

  async function handleToggleApp(app: AppItem) {
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
    } finally {
      setBusyAppId(null);
    }
  }

  async function handleDeleteApp(app: AppItem) {
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
    } finally {
      setBusyAppId(null);
    }
  }

  return (
    <div className="theme-page-shell">
      {/* <PlatformHeader active="apps" /> */}
      <main className="space-y-5">
        <section className="min-w-0 space-y-5">
          <section className="">
            <div className="flex flex-col gap-5">
              <PageHeader title="应用中心" description="管理企业低代码应用、表单入口、运行状态和数据规模，集中维护你创建和参与的业务系统。" actions={<>
                {canManageApps ? (
                  <Button
                    onClick={handleCreateApp}
                    isDisabled={isPending}
                    className="h-10 gap-2 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-text-on-primary)]"
                  >
                    <Plus className="h-4 w-4" />
                    {isPending ? "创建中..." : "创建应用"}
                  </Button>
                ) : null}
                {canImportApps ? (
                  <Button
                    variant="ghost"
                    className="theme-panel h-10 gap-2 rounded-lg px-4 text-sm font-medium text-[var(--color-text-primary)]"
                  >
                    <Rocket className="h-4 w-4" />
                    导入应用
                  </Button>
                ) : null}
              </>} />

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.95fr)]">
                <Card className="theme-panel-soft p-4 shadow-none">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">应用分组</h2>
                    </div>
                    <Funnel className="h-4 w-4 text-[var(--color-text-secondary)]" />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {appGroups.map((group) => (
                      <button
                        key={group.label}
                        type="button"
                        className={[
                          "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm transition-colors",
                          group.active
                            ? "border-[var(--color-border)] bg-[var(--color-primary-soft)] font-medium text-[var(--color-primary)]"
                            : "border-[var(--color-border)] bg-[var(--color-bg-panel-strong)] text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-bg-panel)] hover:text-[var(--color-text-primary)]",
                        ].join(" ")}
                      >
                        <span>{group.label}</span>
                        <span className="rounded-full bg-[var(--color-bg-subtle)] px-2 py-0.5 text-xs font-semibold text-[var(--color-text-secondary)]">
                          {group.count}
                        </span>
                      </button>
                    ))}
                  </div>


                  <div className="flex justify-between mt-4">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                        全部应用
                        <span className="ml-2 text-xs font-medium text-[var(--color-text-secondary)]">
                          共 {apps.length} 个
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {statusTabs.map((tab, index) => (
                          <Button
                            key={tab.label}
                            variant="ghost"
                            className={[
                              "h-9 rounded-lg px-3 text-sm font-medium transition-colors",
                              index === 0
                                ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-panel-soft)] hover:text-[var(--color-text-primary)]",
                            ].join(" ")}
                          >
                            {tab.label}
                            <span className="ml-2 text-xs opacity-75">{tab.count}</span>
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="theme-search-surface flex h-10 w-[280px] items-center gap-2 rounded-xl px-3">
                      <Magnifier className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
                      <Input
                        aria-label="搜索应用"
                        className="flex-1"
                        placeholder="搜索应用名称或负责人"
                      />
                    </div>
                  </div>
                </Card>

                <Card className="theme-panel-soft p-4 shadow-none">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">状态统计</h2>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-4">
                    <MetricCard
                      label="应用总数"
                      value={`${apps.length}`}
                      hint="总览"
                      tone="blue"
                    />
                    <MetricCard
                      label="已启用"
                      value={`${enabledCount}`}
                      hint="在线"
                      tone="green"
                    />
                    <MetricCard
                      label="已关闭"
                      value={`${pausedCount}`}
                      hint="停用"
                      tone="slate"
                    />
                    <MetricCard
                      label="数据记录"
                      value={`${totalRecords}`}
                      hint="累计"
                      tone="amber"
                    />
                  </div>
                </Card>


              </div>
            </div>
          </section>


          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            {sortApps(apps).map((app) => (
              <Card
                key={app.id}
                className="group theme-panel-strong flex min-w-0 flex-col border border-[var(--color-border)] p-3.5 shadow-[var(--shadow-xs)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-card-hover)]"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${appColorToneClass[app.color]}`}
                  >
                    <AppIcon type={app.icon} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <h2 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                            {app.name}
                          </h2>
                          {app.badge ? (
                            <span className="shrink-0 rounded bg-[var(--color-danger-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-danger)]">
                              {app.badge}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 line-clamp-2 min-h-9 text-xs leading-[18px] text-[var(--color-text-secondary)]">
                          {app.desc}
                        </p>
                      </div>
                      {canManageApps || hasPermission(`app:${app.id}:edit_info`) ? <Dropdown>
                        <Dropdown.Trigger
                          aria-label={`${app.name} 更多操作`}
                          className="inline-flex h-7 w-7 min-w-7 shrink-0 items-center justify-center rounded-md p-0 text-[var(--color-text-secondary)] opacity-0 transition-opacity hover:bg-[var(--color-bg-panel-soft)] group-hover:opacity-100 focus:opacity-100"
                        >
                          <Ellipsis className="h-4 w-4" />
                        </Dropdown.Trigger>
                        <Dropdown.Popover>
                          <Dropdown.Menu
                            aria-label={`${app.name} 操作菜单`}
                            className="min-w-[160px]"
                          >
                            {hasPermission(`app:${app.id}:edit_info`) ? <Dropdown.Item
                              id="toggle"
                              isDisabled={busyAppId === app.id}
                              onAction={() => void handleToggleApp(app)}
                            >
                              {app.status === "enabled" ? "关闭" : "启动"}
                            </Dropdown.Item> : null}
                            {hasPermission(`app:${app.id}:edit_info`) ? <Dropdown.Item
                              id="rename"
                              isDisabled={busyAppId === app.id}
                              onAction={() => {
                                setRenameApp(app);
                                setRenameValue(app.name);
                              }}
                            >
                              编辑名称
                            </Dropdown.Item> : null}
                            {canManageApps ? <Dropdown.Item
                              id="delete"
                              isDisabled={busyAppId === app.id}
                              className="text-[var(--color-danger)]"
                              onAction={() => setDeleteApp(app)}
                            >
                              删除应用
                            </Dropdown.Item> : null}
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown> : null}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span
                    className={`inline-flex items-center rounded-md px-1.5 py-1 text-[11px] font-medium ${appStatusTone[app.status]}`}
                  >
                    {appStatusLabel[app.status]}
                  </span>
                  <InfoPill icon={<Clock />} text={`${app.records} 条`} />
                  <InfoPill icon={<Calendar />} text={app.createdAt} />
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-[var(--color-border)] pt-3">
                  <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                    <Avatar className="h-6 w-6 shrink-0 text-[10px]">
                      {app.ownerAvatarUrl ? <Avatar.Image src={app.ownerAvatarUrl} alt="" /> : null}
                      <Avatar.Fallback>{app.owner.slice(0, 1)}</Avatar.Fallback>
                    </Avatar>
                    <span className="truncate">{app.owner}</span>
                  </div>
                  <Link
                    href={`/${app.id}`}
                    aria-label={`访问 ${app.name}`}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-[var(--color-primary)] px-2 text-xs font-medium text-[var(--color-text-on-primary)] transition-colors hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)]"
                  >
                    打开
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </Card>
            ))}
          </section>
        </section>
      </main>

      <Modal isOpen={renameApp !== null} onOpenChange={(isOpen) => !isOpen && setRenameApp(null)}>
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" size="md">
            <Modal.Dialog className="rounded-2xl bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
              <Modal.Header className="border-b border-[var(--color-border)] px-5 py-4">
                <Modal.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
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
              <Modal.Footer className="flex justify-end gap-3 border-t border-[var(--color-border)] px-5 py-3">
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
        <AlertDialog.Backdrop className="theme-modal-backdrop">
          <AlertDialog.Container placement="center" size="md">
            <AlertDialog.Dialog className="rounded-2xl bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
              <AlertDialog.Header className="border-b border-[var(--color-border)] px-5 py-4">
                <AlertDialog.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                  删除应用
                </AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body className="px-5 py-4 text-sm leading-6 text-[var(--color-text-secondary)]">
                {deleteApp
                  ? `确认删除应用“${deleteApp.name}”吗？这会同时删除该应用下的表单、版本和导航数据。`
                  : ""}
              </AlertDialog.Body>
              <AlertDialog.Footer className="flex justify-end gap-3 border-t border-[var(--color-border)] px-5 py-3">
                <Button variant="ghost" onPress={() => setDeleteApp(null)}>
                  取消
                </Button>
                <Button
                  className="bg-[var(--color-danger)] text-[var(--color-text-on-danger)]"
                  isDisabled={!deleteApp || busyAppId === deleteApp.id}
                  onPress={() => deleteApp && void handleDeleteApp(deleteApp)}
                >
                  删除
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
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
    color: normalizeAppColorTone(app.color),
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

function MetricCard({
  hint,
  label,
  tone,
  value,
}: {
  hint: string;
  label: string;
  tone: "blue" | "green" | "amber" | "slate";
  value: string;
}) {
  const toneClassName = {
    blue: "bg-[var(--color-primary-soft)] text-[var(--color-primary)]",
    green: "bg-[var(--color-secondary-soft)] text-[var(--color-secondary)]",
    amber: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
    slate: "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]",
  }[tone];

  return (
    <Card className="border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--color-text-secondary)]">{label}</p>
          <div className="mt-2 text-3xl font-semibold leading-none text-[var(--color-text-primary)]">
            {value}
          </div>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${toneClassName}`}>
          {hint}
        </span>
      </div>
    </Card>
  );
}

function InfoPill({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-[var(--color-bg-panel-soft)] px-1.5 py-1 text-[11px] text-[var(--color-text-secondary)]">
      <span className="flex h-3 w-3 shrink-0 items-center justify-center [&>svg]:h-3 [&>svg]:w-3">
        {icon}
      </span>
      <span className="truncate">{text}</span>
    </span>
  );
}
