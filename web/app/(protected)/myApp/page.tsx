"use client";
import { assertApiEnvelope } from "@/shared/lib/api-request";

import { notifyRequestError } from "@/shared/lib/notify";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dropdown,
  EmptyState,
  TextField,
  Input,
  Label,
  SearchField,
  TextArea,
  ListBox,
  Select,
  ButtonGroup,
} from "@heroui/react";
import { AlertDialog } from "@heroui/react/alert-dialog";
import { Modal } from "@heroui/react/modal";
import { ListUl, Plus, Rocket } from "@gravity-ui/icons";
import {
  createApp,
  deleteApp as deleteAppRequest,
  listApps,
  syncMarketplaceApplications,
  getMarketPublicationCapabilities,
  updateApp,
  type App as ApiApp,
} from "@/features/application/api";
import { FieldOutlineModal } from "@/features/form-designer/components/FieldOutlineModal";
import { PageContentLayout } from "@/shared/ui/PageContentLayout";
import { useAuth } from "@/features/auth/components/AuthProvider";
import {
  normalizeAppColorTone,
  type AppItem,
} from "@/features/application/types";
import { MarketSubmissionsDialog } from "@/features/application/components/MarketSubmissionsDialog";
import { MarketPublishDialog } from "@/features/application/components/MarketPublishDialog";
import { groupApplications } from "@/features/application/app-groups";
import { AppCard } from "./components/AppCard";

export default function MyAppPage() {
  const [apps, setApps] = useState<AppItem[]>([]);
  const [isPending, startTransition] = useTransition();
  const [busyAppId, setBusyAppId] = useState<string | null>(null);
  const [renameApp, setRenameApp] = useState<AppItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [deleteApp, setDeleteApp] = useState<AppItem | null>(null);
  const [publicationMode, setPublicationMode] = useState<"publish" | "export">(
    "publish",
  );
  const [publishingAppId, setPublishingAppId] = useState<string | null>(null);
  const [publicationAccess, setPublicationAccess] = useState<{
    userId: string;
    enabled: boolean;
  } | null>(null);
  const [submittingAppId] = useState<string | null>(null);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [resubmission, setResubmission] = useState<import("@/features/application/api").SubmissionRecord>();
  const [isFieldOutlineOpen, setIsFieldOutlineOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"createdAt" | "updatedAt">("createdAt");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const router = useRouter();
  const { hasPermission, user } = useAuth();
  const canManageApps = hasPermission("apps.manage");
  const canImportApps = hasPermission("market.apps.view");
  const isSystemAdministrator = hasPermission("*");
  const canPublishApps =
    isSystemAdministrator &&
    publicationAccess?.userId === user?.id &&
    publicationAccess?.enabled === true;
  const hasFilters = Boolean(query.trim()) || scope !== "all";

  function resetFilters() {
    setQuery("");
    setScope("all");
  }

  useEffect(() => {
    let cancelled = false;
    if (isSystemAdministrator && user?.id) {
      const userId = user.id;
      void getMarketPublicationCapabilities()
        .then((capabilities) => {
          if (!cancelled)
            setPublicationAccess({
              userId,
              enabled: capabilities.enabled && capabilities.canPublish,
            });
        })
        .catch(() => {
          if (!cancelled) setPublicationAccess(null);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [isSystemAdministrator, user?.id]);

  useEffect(() => {
    let cancelled = false;

    startTransition(async () => {
      try {
        // Remote publication synchronization must not delay local application loading.
        void syncMarketplaceApplications().catch(() => undefined);
        const {
          data,
          error,
          response: httpResponse0,
        } = await listApps({
          responseStyle: "fields",
        });

        assertApiEnvelope(data, error, httpResponse0);

        if (!cancelled) {
          setApps(sortApps(data.data.map(toAppItem).map(normalizeAppItem)));
        }
      } catch (cause) {
        if (!cancelled)
          notifyRequestError(cause, "应用列表加载失败", {
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
      [app.name, app.owner, app.desc, app.marketProductName ?? ""].some(
        (value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
      );
    const matchesScope = scope === "all" || app.owner === user?.displayName;
    return matchesQuery && matchesScope;
  });

  async function handleCreateApp() {
    startTransition(async () => {
      try {
        const {
          data,
          error,
          response: httpResponse1,
        } = await createApp({
          body: {
            name: createName.trim() || undefined,
            description: createDescription.trim() || undefined,
          },
          responseStyle: "fields",
        });

        assertApiEnvelope(data, error, httpResponse1);

        const createdApp = toAppItem(data.data);
        setApps((current) =>
          sortApps([normalizeAppItem(createdApp), ...current]),
        );
        window.dispatchEvent(new Event("yaya-apps-updated"));
        setCreateOpen(false);
        setCreateName("");
        setCreateDescription("");
        router.push(`/${createdApp.id}`);
      } catch {}
    });
  }

  async function handleRenameApp(app: AppItem) {
    const nextName = renameValue.trim();

    if (!nextName) return;

    if (nextName === app.name && renameDescription.trim() === app.desc) {
      setRenameApp(null);
      return;
    }

    setBusyAppId(app.id);

    try {
      const {
        data: payload,
        error,
        response: httpResponse2,
      } = await updateApp({
        path: { appId: app.id },
        body: { name: nextName, description: renameDescription.trim() },
        responseStyle: "fields",
      });
      assertApiEnvelope(payload, error, httpResponse2);

      const updatedApp = normalizeAppItem(toAppItem(payload.data));
      setApps((current) =>
        sortApps(
          current.map((item) => (item.id === app.id ? updatedApp : item)),
        ),
      );
      window.dispatchEvent(new Event("yaya-apps-updated"));
      setRenameApp(null);
    } catch (cause) {
      notifyRequestError(cause, "应用更新失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      setBusyAppId(null);
    }
  }

  async function handleDeleteApp(app: AppItem) {
    setBusyAppId(app.id);

    try {
      const { data, error, response } = await deleteAppRequest({
        path: { appId: app.id },
        responseStyle: "fields",
      });
      assertApiEnvelope(data, error, response);

      setApps((current) => current.filter((item) => item.id !== app.id));
      window.dispatchEvent(
        new CustomEvent("yaya-apps-updated", {
          detail: { deletedAppId: app.id },
        }),
      );
      setDeleteApp(null);
    } catch (cause) {
      notifyRequestError(cause, "删除应用失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      setBusyAppId(null);
    }
  }

  function handleSubmitMarket(app: AppItem) {
    if (!canPublishApps || app.deploymentType !== "local") return;
    setPublicationMode("publish");
    setPublishingAppId(app.id);
  }

  const grouped = groupApplications(filteredApps);
  const renderCard = (app: AppItem) => (
    <AppCard
      key={app.id}
      app={app}
      onOpen={() => router.push(`/${app.id}`)}
      actions={
        app.deploymentType !== "online" &&
        (isSystemAdministrator || app.owner === user?.displayName) ? (
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
            {canPublishApps && app.deploymentType === "local" ? (
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
            ) : null}
            {canPublishApps && app.deploymentType === "local" ? (
              <Dropdown.Item
                id="market-export"
                onAction={() => {
                  setPublicationMode("export");
                  setPublishingAppId(app.id);
                }}
              >
                导出应用包（ZIP）
              </Dropdown.Item>
            ) : null}
          </Dropdown.Menu>
        ) : undefined
      }
    />
  );

  return (
    <PageContentLayout
      title="我的应用"
      subtitle="让业务有序，让协作发生。"
      center={
        <SearchField aria-label="搜索应用" value={query} onChange={setQuery}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="搜索应用名称、描述或负责人" />
            <SearchField.ClearButton aria-label="清除应用搜索" />
          </SearchField.Group>
        </SearchField>
      }
      actions={
        <ButtonGroup>
          {canPublishApps && <Button variant="tertiary" onPress={() => setRecordsOpen(true)}><ListUl />上线申请记录</Button>}
          <Button
            variant="tertiary"
            onPress={() => setIsFieldOutlineOpen(true)}
          >
            <ListUl />
            字段大纲
          </Button>
          {canImportApps ? (
            <Button variant="tertiary" onPress={() => router.push("/market")}>
              <Rocket />
              应用市场
            </Button>
          ) : null}
          {canManageApps ? (
            <Button
              variant="primary"
              onPress={() => setCreateOpen(true)}
              isDisabled={isPending}
            >
              <Plus />
              创建应用
            </Button>
          ) : null}
        </ButtonGroup>
      }
    >
      <main className="@container mx-auto h-full w-full max-w-[1680px] overflow-y-auto p-[clamp(16px,2.4vw,40px)]">
        <div
          className="flex flex-col items-start justify-between gap-6 rounded-2xl border border-[color-mix(in_srgb,var(--color-primary)_16%,var(--color-border))] bg-[radial-gradient(ellipse_at_0_0,color-mix(in_srgb,var(--color-primary)_10%,transparent),transparent_65%),linear-gradient(color-mix(in_srgb,var(--color-bg-surface)_65%,transparent))] p-6 @min-[901px]:flex-row @min-[901px]:items-center @min-[901px]:gap-8 @min-[901px]:px-8 @min-[901px]:py-[30px]"
          aria-label="应用概览"
        >
          <div className="min-w-0 [&_h2]:mt-2.5 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-[-.025em] @min-[481px]:[&_h2]:text-[21px] [&_p]:mt-2 [&_p]:text-[13px] [&_p]:leading-[1.7] [&_p]:text-[var(--color-text-secondary)]">
            <span className="text-[10px] font-semibold tracking-[.18em] text-[var(--color-primary)]">
              APPLICATION WORKSPACE
            </span>
            <h2>业务的每一步，从这里开始</h2>
            <p>连接你的应用、团队与数据，专注每一次业务进展。</p>
          </div>
          <dl className="grid w-full grid-cols-3 gap-2.5 @min-[481px]:gap-4 @min-[901px]:w-auto @min-[901px]:grid-cols-[repeat(3,minmax(90px,1fr))] @min-[901px]:gap-8 [&>div]:border-l [&>div]:border-[var(--color-border)] [&>div]:pl-3.5 @min-[481px]:[&>div]:pl-7 @max-[900px]:[&>div:first-child]:border-l-0 @max-[900px]:[&>div:first-child]:pl-0 [&_dt]:whitespace-nowrap [&_dt]:text-xs [&_dt]:text-[var(--color-text-secondary)] [&_dd]:mt-[9px] [&_dd]:text-2xl [&_dd]:font-semibold [&_dd]:leading-[1.2] [&_dd]:tracking-[-.04em] [&_dd]:tabular-nums @min-[481px]:[&_dd]:text-[30px] [&_span]:ml-1 [&_span]:text-xs [&_span]:font-normal [&_span]:text-[var(--color-text-secondary)] @min-[481px]:[&_span]:ml-2">
            <div>
              <dt>应用总数</dt>
              <dd>
                {apps.length}
                <span>个</span>
              </dd>
            </div>
            <div>
              <dt>线上应用</dt>
              <dd>
                {apps.filter((app) => app.deploymentType === "online").length}
                <span>个</span>
              </dd>
            </div>
            <div>
              <dt>数据记录</dt>
              <dd>
                {apps
                  .reduce((total, app) => total + app.records, 0)
                  .toLocaleString("zh-CN")}
                <span>条</span>
              </dd>
            </div>
          </dl>
        </div>
        <section aria-labelledby="applications-heading" className="mt-8">
          <div className="mb-4 flex items-center justify-between gap-3 [&_h2]:text-base [&_h2]:font-semibold">
            <div className="flex min-w-0 items-center gap-2.5">
              <h2 id="applications-heading">应用分组</h2>
              <span className="rounded-md bg-[var(--color-control-soft)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)] tabular-nums">
                {filteredApps.length}
              </span>
            </div>
            <span className="hidden text-xs text-[var(--color-text-secondary)] @min-[481px]:inline">
              {hasFilters
                ? `共 ${apps.length} 个应用，当前显示 ${filteredApps.length} 个`
                : "你的业务应用，尽在一处"}
            </span>
          </div>
          <div className="mb-[22px] flex flex-wrap items-center justify-end gap-3">
            <div className="flex w-full flex-wrap items-center gap-2 @min-[481px]:w-auto @min-[481px]:gap-2.5">
              <Select
                className="min-w-0 flex-[1_1_120px] @min-[481px]:w-[180px] @min-[481px]:flex-none"
                selectedKey={sortBy}
                onSelectionChange={(key) =>
                  setSortBy(String(key) as typeof sortBy)
                }
              >
                <Label className="sr-only">时间排序</Label>
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
                className="min-w-0 flex-[1_1_120px] @min-[481px]:w-[140px] @min-[481px]:flex-none"
                selectedKey={scope}
                onSelectionChange={(key) =>
                  setScope(String(key) as typeof scope)
                }
              >
                <Label className="sr-only">应用范围</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="all" textValue="全部负责人">
                      全部负责人
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="mine" textValue="我的应用">
                      我的应用
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              {hasFilters ? (
                <Button variant="tertiary" size="sm" onPress={resetFilters}>
                  重置筛选
                </Button>
              ) : null}
            </div>
          </div>
          <section aria-label="本地应用" className="space-y-4 pb-8">
            <h3 className="text-base font-semibold">
              本地应用
              <span className="ml-2 text-xs text-[var(--color-text-secondary)]">
                {grouped.local.length}
              </span>
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] items-start gap-[18px]">
              {grouped.local.map(renderCard)}
            </div>
            {grouped.local.length === 0 && (
              <p className="py-4 text-sm text-[var(--color-text-secondary)]">
                暂无本地应用
              </p>
            )}
          </section>
          <section
            aria-label="线上应用"
            className="space-y-5 border-t border-[var(--color-border)] pt-6 pb-6"
          >
            <h3 className="text-base font-semibold">
              线上应用
              <span className="ml-2 text-xs text-[var(--color-text-secondary)]">
                {filteredApps.length - grouped.local.length}
              </span>
            </h3>
            {grouped.purchased.length > 0 && (
              <section aria-label="购买应用" className="space-y-4">
                <h4 className="text-sm font-medium">购买应用</h4>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] items-start gap-[18px]">
                  {grouped.purchased.map(renderCard)}
                </div>
              </section>
            )}
            {grouped.suites.map((group) => (
              <section
                key={group.id}
                aria-label={`套应用：${group.name}`}
                className="space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">
                    {group.name}
                    <span className="ml-2 rounded-md bg-[var(--color-primary-soft)] px-2 py-1 text-xs font-normal text-[var(--color-primary)]">
                      套应用 · {group.apps.length} 个成员
                    </span>
                  </h4>
                  <Button
                    size="sm"
                    variant="tertiary"
                    onPress={() => router.push("/market")}
                  >
                    管理套应用
                  </Button>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] items-start gap-[18px]">
                  {group.apps.map(renderCard)}
                </div>
              </section>
            ))}
            {grouped.purchased.length === 0 && grouped.suites.length === 0 && (
              <p className="py-4 text-sm text-[var(--color-text-secondary)]">
                暂无已安装的线上应用，可前往应用市场购买或免费领取后安装。
              </p>
            )}
          </section>
          <div>
            {filteredApps.length === 0 ? (
              <EmptyState className="col-span-full flex min-h-[300px] flex-col items-center gap-3.5 rounded-[14px] border border-dashed border-[var(--color-border)] px-5 py-12 text-center [&_h3]:text-[17px] [&_h3]:font-semibold [&_p]:text-[13px] [&_p]:text-[var(--color-text-secondary)]">
                <div className="grid size-[60px] place-items-center rounded-[18px] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-primary)]">
                  <ListUl width={28} height={28} />
                </div>
                <h3>
                  {hasFilters ? "没有找到匹配的应用" : "从第一个应用开始"}
                </h3>
                <p>
                  {hasFilters
                    ? "试试其他关键词，或清除筛选条件。"
                    : "把业务想法变成应用，在这里开启团队协作。"}
                </p>
                {hasFilters ? (
                  <Button variant="secondary" onPress={resetFilters}>
                    清除筛选
                  </Button>
                ) : canManageApps ? (
                  <Button
                    variant="primary"
                    isDisabled={isPending}
                    onPress={() => setCreateOpen(true)}
                  >
                    <Plus />
                    创建应用
                  </Button>
                ) : null}
              </EmptyState>
            ) : null}
          </div>
        </section>
      </main>

      {canPublishApps &&
        publishingAppId &&
        apps.some(
          (app) => app.id === publishingAppId && app.deploymentType === "local",
        ) && (
          <MarketPublishDialog
            appId={publishingAppId}
            mode={publicationMode}
            onClose={() => setPublishingAppId(null)}
          />
        )}
      {canPublishApps && recordsOpen && <MarketSubmissionsDialog onClose={() => setRecordsOpen(false)} onResubmit={(record) => { setRecordsOpen(false); setResubmission(record); }} />}
      {canPublishApps && resubmission && <MarketPublishDialog appId={resubmission.appId} productId={resubmission.productId ?? undefined} memberAppIds={((resubmission.snapshot as {manifest?: {selectedAppIds?: string[]}}).manifest?.selectedAppIds)} onClose={() => setResubmission(undefined)} />}
      <FieldOutlineModal
        isOpen={isFieldOutlineOpen}
        onOpenChange={setIsFieldOutlineOpen}
      />

      <Modal
        isOpen={createOpen || renameApp !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setCreateOpen(false);
            setRenameApp(null);
          }
        }}
      >
        <Modal.Backdrop isDismissable>
          <Modal.Container placement="center" size="md">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>
                  {renameApp ? "编辑应用" : "创建应用"}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-5">
                <TextField
                  fullWidth
                  isRequired
                  className="flex flex-col gap-2"
                  value={renameApp ? renameValue : createName}
                  onChange={renameApp ? setRenameValue : setCreateName}
                >
                  <Label className="text-sm font-medium">应用名称</Label>
                  <Input fullWidth placeholder="请输入应用名称" autoFocus />
                </TextField>
                <TextField
                  fullWidth
                  className="flex flex-col gap-2"
                  value={renameApp ? renameDescription : createDescription}
                  onChange={
                    renameApp ? setRenameDescription : setCreateDescription
                  }
                >
                  <Label className="text-sm font-medium">应用描述</Label>
                  <TextArea
                    fullWidth
                    rows={4}
                    placeholder="描述应用用途（可选）"
                  />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="tertiary"
                  onPress={() => {
                    setCreateOpen(false);
                    setRenameApp(null);
                  }}
                >
                  取消
                </Button>
                <Button
                  variant="primary"
                  onPress={() =>
                    void (renameApp
                      ? handleRenameApp(renameApp)
                      : handleCreateApp())
                  }
                  isDisabled={
                    renameApp
                      ? busyAppId === renameApp.id || !renameValue.trim()
                      : isPending || !createName.trim()
                  }
                >
                  {renameApp ? "保存" : "创建"}
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
    deploymentType:
      ["market", "market_archived"].includes(app.deploymentType) ||
      app.marketInstallationId
        ? "online"
        : "local",
    badge: app.badge ?? undefined,
    color: normalizeAppColorTone(app.color),
  };
}

function normalizeAppItem(app: AppItem): AppItem {
  return app;
}
