"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Dropdown,
  EmptyState,
  Input,
  Label,
  SearchField,
  TextArea,
  toast,
  ListBox,
  Select,
} from "@heroui/react";
import { MySurface } from "@shared/ui/MySurface";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Modal } from "@heroui/react/modal";
import { Plus, Rocket } from "@gravity-ui/icons";
import {
  createApp,
  deleteApp as deleteAppRequest,
  listApps,
  submitAppToMarketplace,
  syncMarketplaceApplications,
  updateApp,
  type App as ApiApp,
} from "@/features/application/api";
import { FieldOutlineModal } from "@components/FieldOutlineModal";
import { PageContentLayout } from "@components/PageContentLayout";
import { useAuth } from "@components/AuthProvider";
import { normalizeAppColorTone, type AppItem } from "@lib/apps";
import { AppCard } from "./AppCard";

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
  const [statusFilter, setStatusFilter] = useState<
    "all" | "notEnabled" | "enabled"
  >("all");
  const [sortBy, setSortBy] = useState<"createdAt" | "updatedAt">("createdAt");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const router = useRouter();
  const { hasPermission, user } = useAuth();
  const canManageApps = hasPermission("apps.manage");
  const canImportApps = hasPermission("apps.import");
  const isSystemAdministrator = hasPermission("*");

  useEffect(() => {
    let cancelled = false;

    startTransition(async () => {
      try {
        await syncMarketplaceApplications<unknown>();
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
        if (!cancelled)
          toast.danger("应用列表加载失败", {
            description:
              cause instanceof Error ? cause.message : "请刷新后重试",
          });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const reload = () => {
      void listApps({ responseStyle: "fields" })
        .then(({ data }) => {
          if (data?.code === 0 && data.data)
            setApps(sortApps(data.data.map(toAppItem).map(normalizeAppItem)));
        })
        .catch(() => undefined);
    };
    window.addEventListener("yaya-apps-updated", reload);
    return () => window.removeEventListener("yaya-apps-updated", reload);
  }, []);

  const filteredApps = sortApps(apps, sortBy).filter((app) => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    const matchesQuery =
      !normalizedQuery ||
      [app.name, app.owner, app.desc].some((value) =>
        value.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
      );
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "enabled" ? app.active === true : app.active !== true);
    const matchesScope = scope === "all" || app.owner === user?.displayName;
    return matchesQuery && matchesStatus && matchesScope;
  });
  const totalRecords = apps.reduce((total, app) => total + app.records, 0);

  async function handleCreateApp() {
    startTransition(async () => {
      try {
        const { data, error } = await createApp({
          body: {
            name: createName.trim() || undefined,
            description: createDescription.trim() || undefined,
          },
          responseStyle: "fields",
        });

        if (error || !data || data.code !== 0 || !data.data) {
          throw new Error("create app failed");
        }

        const createdApp = toAppItem(data.data);
        setApps((current) =>
          sortApps([normalizeAppItem(createdApp), ...current]),
        );
        setCreateOpen(false);
        setCreateName("");
        setCreateDescription("");
        router.push(`/${createdApp.id}`);
      } catch {}
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
      const { data: payload, error } = await updateApp({
        path: { appId: app.id },
        body: { name: nextName, description: renameDescription.trim() },
        responseStyle: "fields",
      });
      if (error || payload?.code !== 0 || !payload.data)
        throw new Error(payload?.message || "应用更新失败");

      const updatedApp = normalizeAppItem(toAppItem(payload.data));
      setApps((current) =>
        sortApps(
          current.map((item) => (item.id === app.id ? updatedApp : item)),
        ),
      );
      setRenameApp(null);
    } catch (cause) {
      toast.danger("应用更新失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      setBusyAppId(null);
    }
  }

  async function handleDeleteApp(app: AppItem) {
    setBusyAppId(app.id);

    try {
      const { data, error } = await deleteAppRequest({
        path: { appId: app.id },
        responseStyle: "fields",
      });
      const payload = data as { code?: number; message?: string } | undefined;
      if (error || payload?.code !== 0)
        throw new Error(payload?.message || "删除应用失败");

      setApps((current) => current.filter((item) => item.id !== app.id));
      setDeleteApp(null);
    } catch (cause) {
      toast.danger("删除应用失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      setBusyAppId(null);
    }
  }

  async function handleSubmitMarket(app: AppItem) {
    setSubmittingAppId(app.id);
    try {
      await submitAppToMarketplace<unknown>(app.id);
      toast.success("上线申请已提交", {
        description: "申请已发送，等待运营中心审核。",
      });
    } catch (cause) {
      toast.danger("上线申请失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试。",
      });
    } finally {
      setSubmittingAppId(null);
    }
  }

  return (
    <PageContentLayout
      title="我的应用"
      subtitle="集中管理应用、业务入口与数据规模。"
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
          <Button onPress={() => setIsFieldOutlineOpen(true)}>字段大纲</Button>
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
      <main className="flex h-full min-h-0 flex-col gap-5">
        <section
          aria-labelledby="applications-heading"
          className="flex min-h-0 flex-1 flex-col"
        >
          <MySurface className="flex flex-wrap items-start justify-between gap-4 p-2">
            <div className="flex min-w-0 items-center gap-3">
              <h2 id="applications-heading" className="page-section-title">
                全部应用
              </h2>
              <span>
                {filteredApps.length} / {apps.length}
              </span>
            </div>

            {/* soft */}
            <div className="flex flex-wrap items-center gap-3">
              <Select
                className="w-[180px]"
                selectedKey={statusFilter}
                onSelectionChange={(key) =>
                  setStatusFilter(String(key) as typeof statusFilter)
                }
              >
                <Label>应用状态</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="all" textValue="全部状态">
                      全部状态
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="notEnabled" textValue="未启用">
                      未启用
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="enabled" textValue="已启用">
                      已启用
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <Select
                className="w-[180px]"
                selectedKey={sortBy}
                onSelectionChange={(key) =>
                  setSortBy(String(key) as typeof sortBy)
                }
              >
                <Label>时间排序</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="createdAt" textValue="按创建时间排序">
                      按创建时间排序
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="updatedAt" textValue="按更新时间排序">
                      按更新时间排序
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <Select
                className="w-[150px]"
                selectedKey={scope}
                onSelectionChange={(key) =>
                  setScope(String(key) as typeof scope)
                }
              >
                <Label>应用范围</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="all" textValue="全部应用">
                      全部应用
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="mine" textValue="我的应用">
                      我的应用
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
          </MySurface>
          <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 content-start gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filteredApps.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                onOpen={() => router.push(`/${app.id}`)}
                actions={
                  isSystemAdministrator || app.owner === user?.displayName ? (
                    <Dropdown.Menu aria-label={`${app.name} 操作菜单`}>
                      <Dropdown.Item
                        id="rename"
                        isDisabled={busyAppId === app.id}
                        onAction={() => {
                          setRenameApp(app);
                          setRenameValue(app.name);
                          setRenameDescription(app.desc);
                        }}
                      >
                        编辑应用
                      </Dropdown.Item>
                      <Dropdown.Item
                        id="delete"
                        isDisabled={busyAppId === app.id}
                        onAction={() => setDeleteApp(app)}
                      >
                        删除应用
                      </Dropdown.Item>
                      <Dropdown.Item
                        id="market-submit"
                        isDisabled={submittingAppId === app.id}
                        onAction={() => void handleSubmitMarket(app)}
                      >
                        <span className="flex items-center gap-2">
                          <Rocket className="h-4 w-4" />
                          上线申请
                        </span>
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  ) : undefined
                }
              />
            ))}
            {filteredApps.length === 0 ? (
              <EmptyState className="col-span-full">
                未找到匹配的应用
              </EmptyState>
            ) : null}
          </div>
        </section>
      </main>

      <FieldOutlineModal
        isOpen={isFieldOutlineOpen}
        onOpenChange={setIsFieldOutlineOpen}
      />

      <Modal isOpen={createOpen} onOpenChange={setCreateOpen}>
        <Modal.Backdrop isDismissable>
          <Modal.Container placement="center" size="md">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>创建应用</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="space-y-3">
                <label className="block text-sm">
                  应用名称
                  <Input
                    className="mt-1"
                    aria-label="应用名称"
                    value={createName}
                    onChange={(event) =>
                      setCreateName(event.currentTarget.value)
                    }
                    placeholder="请输入应用名称"
                    autoFocus
                  />
                </label>
                <label className="block text-sm">
                  应用描述
                  <TextArea
                    className="mt-1"
                    aria-label="应用描述"
                    value={createDescription}
                    onChange={(event) =>
                      setCreateDescription(event.currentTarget.value)
                    }
                    placeholder="描述应用用途（可选）"
                  />
                </label>
              </Modal.Body>
              <Modal.Footer>
                <Button onPress={() => setCreateOpen(false)}>取消</Button>
                <Button
                  onPress={() => void handleCreateApp()}
                  isDisabled={isPending || !createName.trim()}
                >
                  创建
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal
        isOpen={renameApp !== null}
        onOpenChange={(isOpen) => !isOpen && setRenameApp(null)}
      >
        <Modal.Backdrop isDismissable>
          <Modal.Container placement="center" size="md">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>编辑应用</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="space-y-4">
                <div className="space-y-2">
                  <Label className="block text-sm">应用名称</Label>
                  <Input
                    aria-label="应用名称"
                    value={renameValue}
                    onChange={(event) =>
                      setRenameValue(event.currentTarget.value)
                    }
                    placeholder="请输入应用名称"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="block text-sm">应用描述</Label>
                  <TextArea
                    className="w-full"
                    aria-label="应用描述"
                    value={renameDescription}
                    placeholder="请输入应用描述"
                    onChange={(event) =>
                      setRenameDescription(event.currentTarget.value)
                    }
                  />
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button onPress={() => setRenameApp(null)}>取消</Button>
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

      <AlertDialog
        isOpen={deleteApp !== null}
        onOpenChange={(isOpen) => !isOpen && setDeleteApp(null)}
      >
        <AlertDialog.Backdrop>
          <AlertDialog.Container placement="center" size="md">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>删除应用</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                {deleteApp
                  ? `确认删除应用“${deleteApp.name}”吗？这会同时删除该应用下的表单、版本和导航数据。`
                  : ""}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button onPress={() => setDeleteApp(null)}>取消</Button>
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

function sortApps(
  items: AppItem[],
  sortBy: "createdAt" | "updatedAt" = "createdAt",
) {
  return [...items].sort((left, right) => {
    const leftTime =
      sortBy === "updatedAt"
        ? ((left as AppItem & { updatedAt?: string }).updatedAt ??
          left.createdAt)
        : left.createdAt;
    const rightTime =
      sortBy === "updatedAt"
        ? ((right as AppItem & { updatedAt?: string }).updatedAt ??
          right.createdAt)
        : right.createdAt;
    return rightTime.localeCompare(leftTime);
  });
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
