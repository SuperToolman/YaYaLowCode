"use client";
import { notifyRequestError } from "@/shared/lib/notify";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { notify } from "@/shared/lib/notify";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, EmptyState, SearchField } from "@heroui/react";
import { ArrowDownToLine, Box } from "@gravity-ui/icons";
import { PageContentLayout } from "@/shared/ui/PageContentLayout";
import { PaymentModal } from "@/features/settings/components/PaymentModal";
import { PublisherCommercialDialog } from "@/features/application/components/PublisherCommercialDialog";
import { ApplicationOrdersPanel } from "@/features/application/components/ApplicationOrdersPanel";
import { getMarketPublicationCapabilities, checkoutApplication, simulateApplicationPayment, type ApplicationOrder } from "@/features/application/api";
import { MarketPublishDialog } from "@/features/application/components/MarketPublishDialog";
import AiEmployeeMarketPage from "../settings/ai-employee-market/page";
import { archiveMarketplaceInstallation, installMarketplaceApplication, listMarketplaceApplications, listMarketplaceInstallations, preflightMarketplaceApplication, preflightMarketplaceInstallation, purgeMarketplaceInstallation, restoreMarketplaceInstallation, rollbackMarketplaceInstallation, upgradeMarketplaceInstallation } from "@/features/application/api";

type Product = Pick<import("@/shared/lib/http").MarketProduct, "productId" | "publisherOwned" | "name" | "description" | "version" | "releaseId" | "resourceSummary" | "applicationType" | "members" | "owned" | "pricingMode" | "priceCents" | "commercialId" | "commercialReady" | "pendingOrderId">;
type Installation = import("@/shared/lib/http").MarketInstallation;

export default function MarketPage() {
  return <Suspense><MarketPageContent /></Suspense>;
}

function MarketPageContent() {
  const { hasPermission, permissionsReady, user } = useAuth();
  const canViewApps = hasPermission("market.apps.view");
  const canViewAi = hasPermission("settings.ai-employees.view");
  const canManage = hasPermission("market.apps.manage");
  const administrator = hasPermission("*");
  const [publicationAccess, setPublicationAccess] = useState<{userId:string;enabled:boolean} | null>(null);
  const canPublish = administrator && publicationAccess?.userId === user?.id && publicationAccess?.enabled === true;
  useEffect(() => {
    let active = true;
    if (administrator && user?.id) {
      const userId = user.id;
      void getMarketPublicationCapabilities().then(value => { if(active)setPublicationAccess({userId,enabled:value.enabled && value.canPublish}); }).catch(() => { if(active)setPublicationAccess(null); });
    }
    return () => { active = false; };
  },[administrator,user?.id]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeMarket = searchParams.get("tab") === "ai" || (!canViewApps && canViewAi) ? "ai" : "apps";
  const [section, setSection] = useState<"catalogue" | "orders" | "revenues">("catalogue");
  const [commercialProduct,setCommercialProduct]=useState<Product|null>(null);
  const [payment, setPayment] = useState<ApplicationOrder | null>(null);
  const [revision, setRevision] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState<Product | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => {
    setLoading(true);
    try {
      const [market, installed] = await Promise.all([
        listMarketplaceApplications(),
        listMarketplaceInstallations(),
      ]);
      setProducts(market);
      setInstallations(installed);
    } catch (error) {
      notifyRequestError(error, "应用市场不可用", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!permissionsReady || !canViewApps) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [permissionsReady, canViewApps]);
  const cards = useMemo(() => {
    const mapped = new Map(installations.map((item) => [item.productId, item]));
    const known = new Set(products.map((item) => item.productId));
    const retained = installations
      .filter((item) => !known.has(item.productId))
      .map((item) => ({
        product: {
          productId: item.productId,
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
  async function buy(product: Product) {
    if (!product.commercialId) return; setBusy(product.productId);
    try { const order = await checkoutApplication(product.productId, product.commercialId, crypto.randomUUID());
      if (order.status === "completed") { notify.success("免费领取完成，可安装整包应用"); await load(); setRevision(v => v + 1); } else setPayment(order);
    } catch (error) { notifyRequestError(error, "购买失败"); } finally { setBusy(null); }
  }
  async function completePayment() {
    if (!payment) return false;
    try { await simulateApplicationPayment(payment.orderId); await load(); setRevision(v => v + 1); notify.success("模拟支付完成，整包权益已生效"); return true; }
    catch(error) {notifyRequestError(error,"模拟支付失败"); return false;}
  }
  async function install(product: Product) {
    setBusy(product.productId);
    try {
      const check = await preflightMarketplaceApplication(product.productId);
      if (check.blockingIssues.length) throw new Error(check.blockingIssues.join("；"));
      if (check.alreadyInstalled) throw new Error("该应用已安装");
      await installMarketplaceApplication(product.productId);
      notify.success("应用安装完成", {
        description: "已创建整包独立应用，自动化保持禁用状态。",
      });
      await reloadApps();
    } catch (error) {
      notifyRequestError(error, "安装失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setBusy(null);
    }
  }
  function publish(product: Product) { setPublishing(product); }
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
        const result = await preflightMarketplaceInstallation(item.installationId);
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
      notifyRequestError(error, "操作失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setBusy(null);
    }
  }
  if (!permissionsReady) return null;
  if (activeMarket === "ai" ? !canViewAi : !canViewApps) return <p>没有访问此市场的权限。请切换到已授权的市场入口。</p>;
  return (
    <PageContentLayout
      title="市场"
      subtitle={activeMarket === "ai" ? "浏览、购买和安装 AI 员工。" : "浏览应用，自主领取或购买后安装整包应用。"}
      center={
        <div className="flex items-center gap-2">
          <Button isDisabled={!canViewApps} size="sm" variant={activeMarket === "apps" ? "primary" : "secondary"} onPress={() => router.replace("/market")}>应用市场</Button>
          <Button isDisabled={!canViewAi} size="sm" variant={activeMarket === "ai" ? "primary" : "secondary"} onPress={() => router.replace("/market?tab=ai")}>AI员工市场</Button>
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
      <PaymentModal isOpen={Boolean(payment)} onOpenChange={open => { if(!open)setPayment(null); }} productTitle={payment?.snapshot.name} amountCents={payment?.amountCents} billingLabel="一次买断 · 整包权益 · 模拟支付" completionDescription="确认模拟支付后登记应用订单、模拟回款和发布者收益，并自动开通整包权益；不签发新平台许可证，不发生实际扣款。" onTestPaymentComplete={completePayment} />
      {activeMarket === "apps" && <div className="mb-5 flex flex-wrap gap-2">{([ ["catalogue", "应用目录"], ["orders", "我的订单"], ["revenues", "发布者收益"] ] as const).filter(([key]) => key !== "revenues" || canManage).map(([key,label]) => <Button key={key} size="sm" variant={section === key ? "primary" : "secondary"} onPress={() => setSection(key)}>{label}</Button>)}</div>}
      {commercialProduct && <PublisherCommercialDialog productId={commercialProduct.productId} releaseId={commercialProduct.releaseId} name={commercialProduct.name} onClose={()=>setCommercialProduct(null)}/>}
      {canPublish && publishing && publishing.members?.length ? <MarketPublishDialog appId={publishing.members[0].appId} productId={publishing.productId} memberAppIds={publishing.members?.map(m => m.appId)} onClose={() => setPublishing(null)} /> : null}
      {activeMarket === "ai" ? <AiEmployeeMarketPage embedded query={query} /> : section !== "catalogue" ? <ApplicationOrdersPanel mode={section} revision={revision} canManage={canManage} onPay={setPayment} onChanged={() => { setRevision(v => v + 1); void load(); }} /> : <main className="grid grid-cols-1 gap-4 p-1 sm:grid-cols-2 xl:grid-cols-4">
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
              <p className="my-3 text-lg font-semibold">{product.commercialReady ? product.pricingMode === "free" ? "免费" : `¥${((product.priceCents ?? 0) / 100).toFixed(2)}` : "商业资料待完善"}<span className="ml-2 text-xs font-normal">{product.owned ? "已拥有" : product.pricingMode === "paid" ? "一次买断" : ""}</span></p>
              <p className="min-h-10 text-sm text-[var(--color-text-secondary)]">
                {product.description || "暂无应用说明"}
              </p>
              <p className="text-xs text-[var(--color-text-secondary)]">{product.applicationType === "suite" ? "套应用" : "单应用"} · {product.members?.length ?? 1} 个成员</p>
              {product.members && <details className="text-xs"><summary>成员应用</summary>{product.members.map((m) => <p key={m.appId}>{m.name}</p>)}</details>}
              <p className="text-xs text-[var(--color-text-secondary)]">
                表单 {product.resourceSummary?.forms ?? 0} · 自动化{" "}
                {product.resourceSummary?.automations ?? 0} · 导航{" "}
                {product.resourceSummary?.navigation ?? 0}
              </p>
              {own && <Button size="sm" variant="secondary" className="mt-3" isDisabled={!canManage || !product.releaseId} onPress={()=>setCommercialProduct(product)}>销售配置</Button>}
              {own ? (
                <>
                  <p className="text-xs text-[var(--color-success)]">
                    发布者源应用
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      className="flex-1"
                      variant="secondary"
                      isDisabled={!canManage || busy !== null}
                      onPress={() => router.push("/myApp")}
                    >
                      查看成员应用
                    </Button>
                    {canPublish && <Button
                      className="flex-1"
                      isDisabled={busy !== null}
                      onPress={() => void publish(product)}
                    >
                      发布新版本
                    </Button>}
                  </div>
                </>
              ) : !installation && !product.owned ? (
                <Button className="mt-4 w-full" isDisabled={!canManage || loading || busy !== null || !product.commercialReady} onPress={() => void buy(product)}>{busy === product.productId ? "处理中…" : product.pendingOrderId ? "继续支付" : product.pricingMode === "free" ? "免费领取" : "立即购买"}</Button>
              ) : !installation ? (
                <Button
                  className="mt-4 w-full"
                  isDisabled={!canManage || loading || busy !== null}
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
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {installation.status === "installed" ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          isDisabled={!canManage || busy !== null}
                          onPress={() => void manage("preflight", installation)}
                        >
                          预检
                        </Button>
                        <Button
                          size="sm"
                          isDisabled={
                            !canManage || busy !== null ||
                            !updateAvailable
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
                                !canManage || busy !== null
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
                          isDisabled={!canManage || busy !== null}
                          onPress={() => void manage("archive", installation)}
                        >
                          归档
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          isDisabled={!canManage || busy !== null}
                          onPress={() => void manage("restore", installation)}
                        >
                          恢复
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          isDisabled={!canManage || busy !== null}
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
