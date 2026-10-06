"use client";
import { notify } from "@lib/notify";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, EmptyState, SearchField } from "@heroui/react";
import { ArrowDownToLine, Box } from "@gravity-ui/icons";
import { PageContentLayout } from "@components/PageContentLayout";
import AiEmployeeMarketPage from "../settings/ai-employee-market/page";
import {
  archiveMarketplaceInstallation,
  installMarketplaceApplication,
  listMarketplaceApplications,
  listMarketplaceInstallations,
  preflightMarketplaceApplication,
  preflightMarketplaceInstallation,
  purgeMarketplaceInstallation,
  restoreMarketplaceInstallation,
  rollbackMarketplaceInstallation,
  submitAppToMarketplace,
  upgradeMarketplaceInstallation,
} from "@features/application/api";

type Product = {
  productId: string;
  publisherAppId: string;
  publisherOwned?: boolean;
  name: string;
  description: string;
  version: string;
  releaseId: string;
  resourceSummary?: {
    forms?: number;
    automations?: number;
    navigation?: number;
  };
};
type Installation = {
  installationId: string;
  productId: string;
  releaseId: string;
  localAppId: string;
  status: "installed" | "archived";
  legacyMapping: boolean;
  versions?: Array<{ releaseId: string; version: string }>;
};

export default function MarketPage() {
  return <Suspense><MarketPageContent /></Suspense>;
}

function MarketPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeMarket = searchParams.get("tab") === "ai" ? "ai" : "apps";
  const [products, setProducts] = useState<Product[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => {
    setLoading(true);
    try {
      const [market, installed] = await Promise.all([
        listMarketplaceApplications<Product[]>(),
        listMarketplaceInstallations<Installation[]>(),
      ]);
      setProducts(market);
      setInstallations(installed);
    } catch (error) {
      notify.error("应用市场不可用", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const cards = useMemo(() => {
    const mapped = new Map(installations.map((item) => [item.productId, item]));
    const known = new Set(products.map((item) => item.productId));
    const retained = installations
      .filter((item) => !known.has(item.productId))
      .map((item) => ({
        product: {
          productId: item.productId,
          publisherAppId: "",
          name: item.productId,
          description: "此应用已下架，仅保留本地安装管理。",
          version: "-",
          releaseId: item.releaseId,
        } as Product,
        installation: item,
      }));
    return [
      ...products.map((product) => ({
        product,
        installation: mapped.get(product.productId),
      })),
      ...retained,
    ].filter(({ product }) =>
      `${product.name} ${product.description}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  }, [products, installations, query]);
  const reloadApps = async () => {
    window.dispatchEvent(new Event("yaya-apps-updated"));
    await load();
  };
  async function install(product: Product) {
    setBusy(product.productId);
    try {
      const check = await preflightMarketplaceApplication<{
        alreadyInstalled: boolean;
        blockingIssues: string[];
      }>(product.productId);
      if (check.alreadyInstalled)
        throw new Error(check.blockingIssues[0] || "该应用已安装");
      await installMarketplaceApplication(product.productId);
      notify.success("应用安装完成", {
        description: "已创建独立本地应用，自动化保持禁用状态。",
      });
      await reloadApps();
    } catch (error) {
      notify.error("安装失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setBusy(null);
    }
  }
  async function publish(product: Product) {
    setBusy(product.productId);
    try {
      await submitAppToMarketplace(product.publisherAppId);
      notify.success("新版本已提交", {
        description: "审核通过后将更新线上版本。",
      });
    } catch (error) {
      notify.error("提交失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setBusy(null);
    }
  }
  async function manage(
    action:
      | "preflight"
      | "upgrade"
      | "archive"
      | "restore"
      | "purge"
      | "rollback",
    item: Installation,
    releaseId?: string,
  ) {
    setBusy(item.installationId);
    try {
      if (action === "preflight") {
        const result = await preflightMarketplaceInstallation<{
          blockingIssues: string[];
          targetVersion?: string;
        }>(item.installationId);
        notify.info(
          result.blockingIssues?.length
            ? "更新存在阻断项"
            : `可更新至 v${result.targetVersion || "当前版本"}`,
          { description: result.blockingIssues?.join("；") },
        );
      }
      if (action === "upgrade")
        await upgradeMarketplaceInstallation(item.installationId);
      if (action === "archive")
        await archiveMarketplaceInstallation(item.installationId);
      if (action === "restore")
        await restoreMarketplaceInstallation(item.installationId);
      if (action === "purge") {
        if (!window.confirm("永久清理会删除无业务数据的已归档应用，确定继续？"))
          return;
        await purgeMarketplaceInstallation(item.installationId);
      }
      if (action === "rollback")
        await rollbackMarketplaceInstallation(
          item.installationId,
          releaseId || item.releaseId,
        );
      if (action !== "preflight") {
        notify.success("市场应用状态已更新");
        await reloadApps();
      }
    } catch (error) {
      notify.error("操作失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setBusy(null);
    }
  }
  return (
    <PageContentLayout
      title="市场"
      subtitle={activeMarket === "ai" ? "浏览、购买和安装 AI 员工。" : "浏览线上应用，安装、更新和管理已授权应用。"}
      center={
        <div className="flex items-center gap-2">
          <Button size="sm" variant={activeMarket === "apps" ? "primary" : "secondary"} onPress={() => router.replace("/market")}>应用市场</Button>
          <Button size="sm" variant={activeMarket === "ai" ? "primary" : "secondary"} onPress={() => router.replace("/market?tab=ai")}>AI员工市场</Button>
          <SearchField aria-label={activeMarket === "ai" ? "搜索 AI 员工市场" : "搜索应用市场"} value={query} onChange={setQuery}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={activeMarket === "ai" ? "搜索 AI 员工" : "搜索应用"} />
              <SearchField.ClearButton aria-label="清除搜索" />
            </SearchField.Group>
          </SearchField>
        </div>
      }
    >
      {activeMarket === "ai" ? <AiEmployeeMarketPage embedded query={query} /> : <main className="grid grid-cols-1 gap-4 p-1 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ product, installation }) => {
          const own = product.publisherOwned === true;
          const updateAvailable =
            installation?.status === "installed" &&
            installation.releaseId !== product.releaseId;
          return (
            <Card
              key={product.productId}
              className="bg-[var(--color-bg-surface)] p-5 shadow-none"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-control-soft)] text-[var(--color-primary)]">
                    <Box className="h-5 w-5" />
                  </span>
                  {product.name}
                </div>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  v{product.version}
                </span>
              </div>
              <p className="min-h-10 text-sm text-[var(--color-text-secondary)]">
                {product.description || "暂无应用说明"}
              </p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                表单 {product.resourceSummary?.forms ?? 0} · 自动化{" "}
                {product.resourceSummary?.automations ?? 0} · 导航{" "}
                {product.resourceSummary?.navigation ?? 0}
              </p>
              {own ? (
                <>
                  <p className="text-xs text-[var(--color-success)]">
                    已安装 · 线上应用
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      className="flex-1"
                      variant="secondary"
                      isDisabled={busy !== null}
                      onPress={() => router.push(`/${product.publisherAppId}`)}
                    >
                      打开应用
                    </Button>
                    <Button
                      className="flex-1"
                      isDisabled={busy !== null}
                      onPress={() => void publish(product)}
                    >
                      发布新版本
                    </Button>
                  </div>
                </>
              ) : !installation ? (
                <Button
                  className="mt-4 w-full"
                  isDisabled={loading || busy !== null}
                  onPress={() => void install(product)}
                >
                  <ArrowDownToLine className="h-4 w-4" />
                  {busy === product.productId ? "安装中..." : "安装"}
                </Button>
              ) : (
                <>
                  <p className="mt-4 text-xs text-[var(--color-text-secondary)]">
                    {installation.status === "archived"
                      ? "已归档"
                      : updateAvailable
                        ? "有可用更新"
                        : "已安装，已是当前版本"}
                    {installation.legacyMapping ? " · 旧版安装" : ""}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {installation.status === "installed" ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          isDisabled={busy !== null}
                          onPress={() => void manage("preflight", installation)}
                        >
                          预检
                        </Button>
                        <Button
                          size="sm"
                          isDisabled={
                            busy !== null ||
                            !updateAvailable ||
                            installation.legacyMapping
                          }
                          onPress={() => void manage("upgrade", installation)}
                        >
                          更新
                        </Button>
                        {installation.versions
                          ?.filter(
                            (version) =>
                              version.releaseId !== installation.releaseId,
                          )
                          .map((version) => (
                            <Button
                              key={version.releaseId}
                              size="sm"
                              variant="secondary"
                              isDisabled={
                                busy !== null || installation.legacyMapping
                              }
                              onPress={() =>
                                void manage(
                                  "rollback",
                                  installation,
                                  version.releaseId,
                                )
                              }
                            >
                              回滚 v{version.version}
                            </Button>
                          ))}
                        <Button
                          size="sm"
                          variant="secondary"
                          isDisabled={busy !== null}
                          onPress={() => void manage("archive", installation)}
                        >
                          归档
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          isDisabled={busy !== null}
                          onPress={() => void manage("restore", installation)}
                        >
                          恢复
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          isDisabled={busy !== null}
                          onPress={() => void manage("purge", installation)}
                        >
                          永久清理
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )}
            </Card>
          );
        })}
        {!loading && cards.length === 0 ? (
          <EmptyState className="col-span-full">暂无可用应用</EmptyState>
        ) : null}
      </main>}
    </PageContentLayout>
  );
}
