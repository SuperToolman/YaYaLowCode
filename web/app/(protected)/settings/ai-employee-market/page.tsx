"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRotateRight,
  CircleExclamation,
  FaceRobot,
  Magnifier,
} from "@gravity-ui/icons";
import {
  Button,
  Card,
  Chip,
  Input,
  Popover,
  Tooltip,
  toast,
} from "@heroui/react";
import { MySurface } from "@shared/ui/MySurface";
import { openLicenseUpdatePrompt } from "@components/LicenseManagementModal";
import { PaymentModal } from "@components/PaymentModal";
import { SettingsContentCard } from "../components/SettingsContentCard";
import {
  getAiEmployees,
  installMarketAiEmployee,
  testMarketAiEmployeePurchase,
  uninstallMarketAiEmployee,
} from "@features/settings/api";

type MarketEmployee = {
  id: string;
  title: string;
  description: string;
  category: string;
  priceCents: number;
  billingCycle: "month" | "year" | "one_time";
  version: string;
  avatarUrl?: string | null;
  latestPackageVersion: string;
  installedPackageVersion: string | null;
  owned: boolean;
  installed: boolean;
  expiresAt: number | null;
};

const billingText = {
  month: "按月授权",
  year: "按年授权",
  one_time: "一次性购买",
} as const;

export default function AiEmployeeMarketPage() {
  const [employees, setEmployees] = useState<MarketEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [currentTimestamp, setCurrentTimestamp] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [purchase, setPurchase] = useState<MarketEmployee | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setEmployees(await getAiEmployees<MarketEmployee[]>());
      setCurrentTimestamp(Math.floor(Date.now() / 1000));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取 AI 员工市场");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const handleLicenseUpdated = () => void load();
    window.addEventListener("yaya-license-updated", handleLicenseUpdated);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("yaya-license-updated", handleLicenseUpdated);
    };
  }, [load]);

  const categories = useMemo(
    () =>
      [...new Set(employees.map((employee) => employee.category))].sort(
        (left, right) => left.localeCompare(right, "zh-CN"),
      ),
    [employees],
  );

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return employees.filter((employee) => {
      const matchesCategory =
        category === "all" || employee.category === category;
      const matchesQuery =
        !keyword ||
        [
          employee.title,
          employee.description,
          employee.category,
          employee.id,
        ].some((value) => value.toLowerCase().includes(keyword));
      return matchesCategory && matchesQuery;
    });
  }, [category, employees, query]);
  const installedCount = employees.filter(
    (employee) => employee.installed,
  ).length;
  const runningCount = employees.filter(
    (employee) =>
      employee.installed &&
      (!employee.expiresAt || employee.expiresAt >= currentTimestamp),
  ).length;
  const expiredCount = installedCount - runningCount;

  async function install(employee: MarketEmployee) {
    setInstallingId(employee.id);
    try {
      await installMarketAiEmployee<unknown>(employee.id);
      toast.success("AI 员工已安装", { description: employee.title });
      await load();
    } catch (cause) {
      toast.danger("安装失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      setInstallingId(null);
    }
  }

  async function sync(employee: MarketEmployee) {
    setSyncingId(employee.id);
    try {
      await installMarketAiEmployee<unknown>(employee.id);
      toast.success("AI 员工已更新", { description: employee.title });
      await load();
    } catch (cause) {
      toast.danger("AI 员工更新失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      setSyncingId(null);
    }
  }

  async function remove(employee: MarketEmployee) {
    setRemovingId(employee.id);
    try {
      await uninstallMarketAiEmployee<unknown>(employee.id);
      toast.success("AI 员工已移除", { description: employee.title });
      await load();
    } catch (cause) {
      toast.danger("AI 员工移除失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      setRemovingId(null);
    }
  }

  async function completeTestPayment() {
    if (!purchase) return false;
    try {
      const payload = await testMarketAiEmployeePurchase<{
        orderNo: string;
        licenseId: string;
      }>(purchase.id);
      toast.success("测试支付完成", {
        description: `订单 ${payload.orderNo} 已回款并签发新许可证`,
      });
      window.setTimeout(openLicenseUpdatePrompt, 0);
      return true;
    } catch (cause) {
      toast.danger("测试支付失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
      return false;
    }
  }

  return (
    <>
      <SettingsContentCard
        title="AI员工市场"
        subtitle="浏览运营管理平台上架的 AI 员工，购买权益后安装到当前客户环境。"
        headerActions={
          <div className="flex items-center gap-1">
            <Popover>
              <Popover.Trigger>
                <Button
                  isIconOnly
                  variant="ghost"
                  className="bg-[var(--color-warning-soft)] text-[var(--color-warning)] hover:bg-[var(--color-warning-soft)]"
                  aria-label="AI 员工包管理说明"
                >
                  <CircleExclamation className="h-4 w-4" />
                </Button>
              </Popover.Trigger>
              <Popover.Content className="w-[min(24rem,calc(100vw-2rem))] !border !border-[var(--color-border)] !bg-[var(--color-bg-surface)] p-4 !opacity-100 shadow-[var(--shadow-floating)]">
                <Popover.Dialog
                  aria-label="AI 员工包管理说明"
                  className="space-y-3 text-xs leading-5 text-[var(--color-text-primary)]"
                >
                  <p className="font-semibold">AI 员工包管理</p>
                  <p>
                    运营管理平台维护 AI
                    员工商品、版本和授权权益。安装或更新时，平台校验许可证并保存受签名保护的员工定义；Cordis
                    会在运行时读取有效定义。
                  </p>
                  <div className="space-y-1 rounded-md bg-[var(--color-bg-subtle)] p-3">
                    <p className="font-medium">本地固定存储</p>
                    <p>
                      安装清单：
                      <code className="break-all font-mono">
                        runtime/state/installed-ai-employees.json
                      </code>
                    </p>
                    <p>
                      授权快照：
                      <code className="break-all font-mono">
                        runtime/state/installed-ai-employee-packages.json
                      </code>
                    </p>
                  </div>
                  <p>
                    客户只能安装、更新和移除授权员工；Persona、Skills、工具边界和系统提示词由运营端发布。
                  </p>
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
            <Tooltip>
              <Tooltip.Trigger>
                <Button
                  isIconOnly
                  variant="secondary"
                  aria-label="刷新 AI 员工市场"
                  isDisabled={loading}
                  onPress={() => void load()}
                >
                  <ArrowRotateRight
                    className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                  />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>刷新</Tooltip.Content>
            </Tooltip>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Summary label="商品数量" value={employees.length} />
            <Summary label="已安装" value={installedCount} />
            <Summary label="运行中" value={runningCount} />
            <Summary label="已过期" value={expiredCount} />
          </div>
          <div className="flex justify-between">
            <Input
              className="w-full xl:max-w-md"
              aria-label="搜索 AI 员工"
              placeholder="搜索名称、分类或能力"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <div className="flex items-center justify-between gap-3 xl:justify-end">
              <p className="shrink-0 text-sm text-[var(--color-text-secondary)]">
                {loading ? "正在更新" : `共 ${filtered.length} 位员工`}
              </p>
              <div className="flex max-w-full gap-1 overflow-x-auto pb-1">
                <CategoryFilter
                  label="全部"
                  count={employees.length}
                  active={category === "all"}
                  onPress={() => setCategory("all")}
                />
                {categories.map((item) => (
                  <CategoryFilter
                    key={item}
                    label={item}
                    count={
                      employees.filter((employee) => employee.category === item)
                        .length
                    }
                    active={category === item}
                    onPress={() => setCategory(item)}
                  />
                ))}
              </div>
            </div>
          </div>
          {error ? (
            <p className="py-3 text-sm text-[var(--color-danger)]">{error}</p>
          ) : null}
          {!error && filtered.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              {filtered.map((employee) => (
                <MySurface className="p-3" key={employee.id}>
                  <div className="flex min-w-0 items-start gap-3">
                    <MarketEmployeeAvatar employee={employee} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                          {employee.title}
                        </h3>
                        <Chip size="sm" variant="soft">
                          {employee.category}
                        </Chip>
                      </div>
                      <p className="truncate font-mono text-xs text-[var(--color-text-secondary)]">
                        v{employee.version}
                      </p>
                    </div>
                    <OwnershipChip employee={employee} />
                  </div>
                  {employee.installed ? (
                    <>
                      <div className="flex min-w-0 items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
                        <p className="min-w-0 truncate font-mono text-xs text-[var(--color-text-secondary)]">
                          包 v{employee.installedPackageVersion || "未知"} → v
                          {employee.latestPackageVersion}
                        </p>
                        <div className="text-right">
                          <p className="text-xs text-[var(--color-text-secondary)]">
                            有效期至
                          </p>
                          <p className="mt-1 whitespace-nowrap text-xs font-medium">
                            {employee.expiresAt
                              ? formatExpiry(employee.expiresAt)
                              : "永久有效"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex justify-end gap-2 border-t border-[var(--color-border)] pt-3">
                        <Button
                          size="sm"
                          isPending={syncingId === employee.id}
                          isDisabled={
                            Boolean(syncingId) ||
                            Boolean(removingId) ||
                            (employee.expiresAt !== null &&
                              employee.expiresAt < currentTimestamp)
                          }
                          onPress={() => void sync(employee)}
                        >
                          {employee.installedPackageVersion !==
                          employee.latestPackageVersion
                            ? "更新"
                            : "同步"}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-soft"
                          isPending={removingId === employee.id}
                          isDisabled={Boolean(syncingId) || Boolean(removingId)}
                          onPress={() => void remove(employee)}
                        >
                          移除
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mt-3 flex items-end justify-between gap-3 border-t border-[var(--color-border)] pt-3">
                        <div className="min-w-0">
                          <p className="text-base font-semibold text-[var(--color-text-primary)]">
                            {formatMoney(employee.priceCents)}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
                            {billingText[employee.billingCycle]}
                            {employee.owned && employee.expiresAt
                              ? ` · 至 ${formatExpiry(employee.expiresAt)}`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex justify-end">
                        {employee.owned ? (
                          <Button
                            size="sm"
                            isPending={installingId === employee.id}
                            onPress={() => void install(employee)}
                          >
                            安装
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onPress={() => setPurchase(employee)}
                          >
                            购买
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                </MySurface>
              ))}
            </div>
          ) : !error ? (
            <div className="flex min-h-72 flex-col items-center justify-center border-y border-[var(--color-border)] px-6 py-12 text-center">
              <Magnifier className="h-6 w-6 text-[var(--color-text-secondary)]" />
              <h3 className="mt-4 text-base font-semibold text-[var(--color-text-primary)]">
                {loading ? "正在读取 AI 员工市场" : "没有匹配的 AI 员工"}
              </h3>
            </div>
          ) : null}
        </div>
      </SettingsContentCard>
      <PaymentModal
        isOpen={Boolean(purchase)}
        onOpenChange={(open) => {
          if (!open) setPurchase(null);
        }}
        productTitle={purchase?.title}
        amountCents={purchase?.priceCents}
        billingLabel={purchase ? billingText[purchase.billingCycle] : undefined}
        onTestPaymentComplete={completeTestPayment}
      />
    </>
  );
}

function CategoryFilter({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "primary" : "ghost"}
      className="shrink-0"
      onPress={onPress}
    >
      {label}
      <span className="ml-1 opacity-70">{count}</span>
    </Button>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <MySurface className="p-2">
      <p className="text-xs text-[var(--color-text-secondary)]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </MySurface>
  );
}

function OwnershipChip({ employee }: { employee: MarketEmployee }) {
  if (employee.installed)
    return (
      <Chip size="sm" color="success" variant="soft">
        已安装
      </Chip>
    );
  if (employee.owned)
    return (
      <Chip size="sm" color="accent" variant="soft">
        已经拥有，未安装
      </Chip>
    );
  return (
    <Chip size="sm" variant="soft">
      未购买
    </Chip>
  );
}

function MarketEmployeeAvatar({ employee }: { employee: MarketEmployee }) {
  const [failed, setFailed] = useState(false);
  // Always probe the stable platform proxy URL. Older cached market payloads
  // may omit avatarUrl even though the employee already has an avatar.
  const src =
    employee.avatarUrl ||
    `/api/ai-employees/${encodeURIComponent(employee.id)}/avatar`;
  if (failed) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
        <FaceRobot className="h-5 w-5" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={`${employee.title}头像`}
      className="h-9 w-9 shrink-0 rounded-md object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(cents / 100);
}

function formatExpiry(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN");
}
