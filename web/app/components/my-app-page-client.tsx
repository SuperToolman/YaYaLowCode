"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Button, Card, Chip, Dropdown, Input, SearchField, TextArea, toast } from "@heroui/react";
import { MyAvatar } from "./my-avatar";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Modal } from "@heroui/react/modal";
import { Calendar, Clock, Ellipsis, Plus, Rocket } from "@gravity-ui/icons";
import { createApp, listApps, type App as ApiApp } from "@/features/application/api";
import { HomeQuickAccess } from "./home-page-client";
import { AppIcon } from "./app-icons";
import { MySurface } from "./my-surface";
import { FieldOutlineModal } from "./field-outline-modal";
import { PageContentLayout } from "./page-content-layout";
import { useAuth } from "./auth-provider";
import {
  appColorToneClass,
  appColorBorderClass,
  normalizeAppColorTone,
  type AppItem,
} from "../lib/apps";

type MyAppPageClientProps = {
  initialApps: AppItem[];
};

export function MyAppPageClient({ initialApps }: MyAppPageClientProps) {
  const [apps, setApps] = useState(sortApps(initialApps.map(normalizeAppItem)));
  const [isPending, startTransition] = useTransition();
  const [busyAppId, setBusyAppId] = useState<string | null>(null);
  const [renameApp, setRenameApp] = useState<AppItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [deleteApp, setDeleteApp] = useState<AppItem | null>(null);
  const [submittingAppId, setSubmittingAppId] = useState<string | null>(null);
  const [isFieldOutlineOpen, setIsFieldOutlineOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const { hasPermission, user } = useAuth();
  const canManageApps = hasPermission("apps.manage");
  const canImportApps = hasPermission("apps.import");
  const isSystemAdministrator = hasPermission("*");

  useEffect(() => {
    let cancelled = false;

    startTransition(async () => {
      try {
        await fetch("/api/market/applications/sync", { method: "POST" });
        const { data, error } = await listApps({
          responseStyle: "fields",
        });

        if (error || !data || data.code !== 0 || !data.data) {
          throw new Error("load apps failed");
        }

        if (!cancelled) {
          setApps(sortApps(data.data.map(toAppItem).map(normalizeAppItem)));
        }
      } catch (cause) {
        if (!cancelled) toast.danger("应用列表加载失败", { description: cause instanceof Error ? cause.message : "请刷新后重试" });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const reload = () => {
      void listApps({ responseStyle: "fields" }).then(({ data }) => {
        if (data?.code === 0 && data.data) setApps(sortApps(data.data.map(toAppItem).map(normalizeAppItem)));
      }).catch(() => undefined);
    };
    window.addEventListener("yaya-apps-updated", reload);
    return () => window.removeEventListener("yaya-apps-updated", reload);
  }, []);

  const filteredApps = sortApps(apps).filter((app) => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    const matchesQuery = !normalizedQuery || [app.name, app.owner, app.desc]
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
    return matchesQuery;
  });
  const totalRecords = apps.reduce((total, app) => total + app.records, 0);

  async function handleCreateApp() {
    startTransition(async () => {
      try {
        const { data, error } = await createApp({
          body: { name: createName.trim() || undefined, description: createDescription.trim() || undefined },
          responseStyle: "fields",
        });

        if (error || !data || data.code !== 0 || !data.data) {
          throw new Error("create app failed");
        }

        const createdApp = toAppItem(data.data);
        setApps((current) => sortApps([normalizeAppItem(createdApp), ...current]));
        setCreateOpen(false);
        setCreateName("");
        setCreateDescription("");
        router.push(`/${createdApp.id}`);
      } catch { }
    });
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
        body: JSON.stringify({ name: nextName, description: renameDescription.trim() }),
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
    } catch (cause) {
      toast.danger("应用更新失败", { description: cause instanceof Error ? cause.message : "请稍后重试" });
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
    } catch (cause) {
      toast.danger("删除应用失败", { description: cause instanceof Error ? cause.message : "请稍后重试" });
    } finally {
      setBusyAppId(null);
    }
  }

  async function handleSubmitMarket(app: AppItem) {
    setSubmittingAppId(app.id);
    try {
      const response = await fetch(`/api/apps/${encodeURIComponent(app.id)}/market-submission`, { method: "POST" });
      const payload = await response.json() as { code: number; message: string };
      if (!response.ok || payload.code !== 0) throw new Error(payload.message || "上线申请失败");
      toast.success("上线申请已提交", { description: payload.message || "申请已发送，等待运营中心审核。" });
    } catch (cause) {
      toast.danger("上线申请失败", { description: cause instanceof Error ? cause.message : "请稍后重试。" });
    } finally {
      setSubmittingAppId(null);
    }
  }

  return (
    <PageContentLayout
      title={`你好，${user?.displayName || "管理员"}`}
      subtitle="集中管理应用与业务入口。"
      center={
        <SearchField aria-label="搜索应用" value={query} onChange={setQuery}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="搜索应用名称或负责人" />
            <SearchField.ClearButton aria-label="清除应用搜索" />
          </SearchField.Group>
        </SearchField>
      }
      actions={
        <>
                <Button onPress={() => setIsFieldOutlineOpen(true)}>
                  字段大纲
                </Button>
                {canManageApps ? (
                    <Button onClick={() => setCreateOpen(true)} isDisabled={isPending}>
                    <Plus />
                    {isPending ? "创建中..." : "创建应用"}
                  </Button>
                ) : null}
                {canImportApps ? (
                  <Button>
                    <Rocket />
                    导入应用
                  </Button>
                ) : null}
        </>
      }
    >
      <main className="mx-auto flex h-full min-h-0 w-full flex-col gap-4">

        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Card.Content className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-6 sm:py-5">
          <HomeQuickAccess apps={apps} />

          <section aria-labelledby="applications-heading" className="flex min-h-0 flex-1 flex-col pt-5">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-separator pb-4">
              <div className="flex min-w-0 items-center gap-3">
                <h2 id="applications-heading" className="page-section-title">应用筛选</h2>
                <span className="text-xs text-muted">{filteredApps.length} / {apps.length}</span>
              </div>
              <dl className="grid grid-cols-4 gap-x-5 sm:gap-x-7">
                <SummaryMetric label="应用" value={apps.length} />
                <SummaryMetric label="可见应用" value={apps.length} />
                <SummaryMetric label="数据记录" value={totalRecords} />
              </dl>
            </div>
          <div className="mt-5 flex items-center justify-between">
            <h2 className="page-section-title">全部应用</h2>
            <p className="page-section-meta">按创建时间排序</p>
          </div>
          <div className="mt-5 grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredApps.map((app) => (
              <AppCard key={app.id} app={app} onOpen={() => router.push(`/${app.id}`)} actions={(isSystemAdministrator || app.owner === user?.displayName) ? <Dropdown.Menu aria-label={`${app.name} 操作菜单`}>
                <Dropdown.Item id="rename" isDisabled={busyAppId === app.id} onAction={() => { setRenameApp(app); setRenameValue(app.name); setRenameDescription(app.desc); }}>编辑应用</Dropdown.Item>
                <Dropdown.Item id="delete" isDisabled={busyAppId === app.id} onAction={() => setDeleteApp(app)}>删除应用</Dropdown.Item>
                    <Dropdown.Item id="market-submit" isDisabled={submittingAppId === app.id} onAction={() => void handleSubmitMarket(app)}><span className="flex items-center gap-2"><Rocket className="h-4 w-4" />上线申请</span></Dropdown.Item>
              </Dropdown.Menu> : undefined} />
            ))}
            {filteredApps.length === 0 ? <div className="col-span-full py-12 text-center">未找到匹配的应用</div> : null}
          </div>
          </section>
          </Card.Content>
        </Card>
      </main>

      <FieldOutlineModal isOpen={isFieldOutlineOpen} onOpenChange={setIsFieldOutlineOpen} />

      <Modal isOpen={createOpen} onOpenChange={setCreateOpen}>
        <Modal.Backdrop isDismissable><Modal.Container placement="center" size="md"><Modal.Dialog>
          <Modal.Header><Modal.Heading>创建应用</Modal.Heading></Modal.Header>
          <Modal.Body className="space-y-3">
            <label className="block text-sm">应用名称<Input className="mt-1" aria-label="应用名称" value={createName} onChange={(event) => setCreateName(event.currentTarget.value)} placeholder="请输入应用名称" autoFocus /></label>
            <label className="block text-sm">应用描述<TextArea className="mt-1" aria-label="应用描述" value={createDescription} onChange={(event) => setCreateDescription(event.currentTarget.value)} placeholder="描述应用用途（可选）" /></label>
          </Modal.Body>
          <Modal.Footer><Button onPress={() => setCreateOpen(false)}>取消</Button><Button onPress={() => void handleCreateApp()} isDisabled={isPending || !createName.trim()}>创建</Button></Modal.Footer>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>

      <Modal isOpen={renameApp !== null} onOpenChange={(isOpen) => !isOpen && setRenameApp(null)}>
        <Modal.Backdrop isDismissable>
          <Modal.Container placement="center" size="md">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>
                  编辑应用
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <Input
                  aria-label="应用名称"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.currentTarget.value)}
                  placeholder="请输入应用名称"
                />
                <label className="mt-3 block text-sm">应用描述<TextArea className="mt-1" aria-label="应用描述" value={renameDescription} onChange={(event) => setRenameDescription(event.currentTarget.value)} placeholder="请输入应用描述" /></label>
              </Modal.Body>
              <Modal.Footer>
                <Button onPress={() => setRenameApp(null)}>
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
        <AlertDialog.Backdrop>
          <AlertDialog.Container placement="center" size="md">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>
                  删除应用
                </AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                {deleteApp
                  ? `确认删除应用“${deleteApp.name}”吗？这会同时删除该应用下的表单、版本和导航数据。`
                  : ""}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button onPress={() => setDeleteApp(null)}>
                  取消
                </Button>
                <Button
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
    </PageContentLayout>
  );
}

function sortApps(items: AppItem[]) {
  return [...items].sort((left, right) => {
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function AppCard({ app, actions, onOpen }: { app: AppItem; actions?: ReactNode; onOpen: () => void }) {
  const tone = appColorToneClass[app.color];
  return <MySurface role="link" tabIndex={0} aria-label={`打开 ${app.name}`} onClick={onOpen} onKeyDown={(event: KeyboardEvent<HTMLElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }} className={`group min-w-0 cursor-pointer overflow-hidden border-l-4 ${appColorBorderClass[app.color]} transition-all hover:-translate-y-0.5 hover:bg-default/70 hover:shadow-md focus-visible:ring-2 focus-visible:ring-focus`}>
    <div className="flex min-h-52 flex-col p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className={`shrink-0 ${tone}`}><Avatar.Fallback><AppIcon type={app.icon} /></Avatar.Fallback></Avatar>
          <div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><h3 className="truncate text-sm font-semibold text-foreground">{app.name}</h3>{app.badge ? <Chip size="sm" className={tone}>{app.badge}</Chip> : null}</div><p className="mt-1 truncate text-xs text-muted">{app.desc}</p></div>
        </div>
        {actions ? <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><Dropdown><Dropdown.Trigger aria-label={`${app.name} 更多操作`} className="-mr-2 -mt-2 rounded-full p-2 text-muted opacity-60 transition-opacity hover:bg-default/60 hover:text-foreground group-hover:opacity-100"><Ellipsis /></Dropdown.Trigger><Dropdown.Popover>{actions}</Dropdown.Popover></Dropdown></div> : null}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-1.5 text-xs">{app.deploymentType === "online" ? <Chip size="sm" className={tone}>线上应用 {app.onlineVersion || "-"}</Chip> : null}<Chip size="sm" className="bg-default/60 text-muted"><Clock />{app.records} 条记录</Chip></div>
      <div className="mt-auto flex items-end justify-between gap-3 border-t border-separator pt-4"><div className="flex min-w-0 items-center gap-2 text-xs text-muted"><MyAvatar name={app.owner} imageUrl={app.ownerAvatarUrl} size="sm" /><span className="min-w-0 truncate">{app.owner}</span><span className="shrink-0 opacity-60">·</span><span className="flex shrink-0 items-center gap-1"><Calendar />{app.createdAt}</span></div><span className="shrink-0 text-xs font-medium text-accent">点击卡片进入</span></div>
    </div>
  </MySurface>;
}

function toAppItem(app: ApiApp): AppItem {
  return {
    ...app,
    deploymentType: app.deploymentType === "online" ? "online" : "local",
    badge: app.badge ?? undefined,
    color: normalizeAppColorTone(app.color),
  };
}

function normalizeAppItem(app: AppItem): AppItem {
  return app;
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-14">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold leading-none text-foreground">{value}</dd>
    </div>
  );
}
