"use client";
import Image from "next/image";
import { notifyRequestError } from "@/shared/lib/notify";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { notify } from "@/shared/lib/notify";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowRotateRight, CircleExclamation, FaceRobot, Magnifier, ShoppingCart, TrashBin } from "@gravity-ui/icons";
import { Button, Chip, Modal, Popover, Tabs, Tooltip } from "@heroui/react";
import { MySurface } from "@/shared/ui/MySurface";
import { openLicenseUpdatePrompt } from "@/features/settings/components/LicenseManagementModal";
import { PaymentModal } from "@/features/settings/components/PaymentModal";
import { SettingsContentCard } from "../components/SettingsContentCard";
import { EmployeeKnowledgePanel } from "@/features/knowledge/EmployeeKnowledgePanel";
import { getAiEmployees, installMarketAiEmployee, testMarketAiEmployeePurchase, uninstallMarketAiEmployee } from "@/features/settings/api";

type MarketEmployee = import("@/shared/lib/http").AiEmployeeMarketItem;

const billingText: Record<string, string> = {
  month: "按月授权",
  year: "按年授权",
  one_time: "一次性购买",
} as const;

export default function AiEmployeeMarketPage({
  embedded = false,
  query = "",
}: {
  embedded?: boolean;
  query?: string;
}) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("settings.ai-employees.manage");
  const router = useRouter();
  const [employees, setEmployees] = useState<MarketEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [currentTimestamp, setCurrentTimestamp] = useState(0);
  const [category, setCategory] = useState("all");
  const [purchase, setPurchase] = useState<MarketEmployee | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const selectedEmployee = employees.find(
    (employee) => employee.id === selectedId,
  );
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setEmployees(await getAiEmployees());
      setCurrentTimestamp(Math.floor(Date.now() / 1000));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取 AI 员工市场");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!embedded) {
      router.replace("/market?tab=ai");
      return;
    }
    const timer = window.setTimeout(() => void load(), 0);
    const handleLicenseUpdated = () => void load();
    window.addEventListener("yaya-license-updated", handleLicenseUpdated);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("yaya-license-updated", handleLicenseUpdated);
    };
  }, [embedded, load, router]);

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
  const expiredCount = employees.filter(
    (employee) =>
      employee.installed &&
      employee.expiresAt != null &&
      employee.expiresAt < currentTimestamp,
  ).length;

  async function install(employee: MarketEmployee) {
    setSelectedId(employee.id);
    setDetailsOpen(true);
    setInstallingId(employee.id);
    try {
      await installMarketAiEmployee(employee.id);
      notify.success("AI 员工已安装", {
        description: "现在可以使用该员工开始任务。",
      });
      await load();
    } catch (cause) {
      notifyRequestError(cause, "安装失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      await load();
      setInstallingId(null);
    }
  }

  async function sync(employee: MarketEmployee) {
    setSelectedId(employee.id);
    setDetailsOpen(true);
    setSyncingId(employee.id);
    try {
      await installMarketAiEmployee(employee.id);
      notify.success("AI 员工已更新", {
        description: employee.title,
      });
      await load();
    } catch (cause) {
      notifyRequestError(cause, "AI 员工更新失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      await load();
      setSyncingId(null);
    }
  }

  async function remove(employee: MarketEmployee) {
    setRemovingId(employee.id);
    try {
      await uninstallMarketAiEmployee(employee.id);
      notify.success("AI 员工已卸载", { description: employee.title });
      await load();
    } catch (cause) {
      notifyRequestError(cause, "AI 员工卸载失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      setRemovingId(null);
    }
  }

  async function completeTestPayment() {
    if (!purchase) return false;
    try {
      const payload = await testMarketAiEmployeePurchase(purchase.id);
      notify.success("测试支付完成", {
        description: `订单 ${payload.orderNo} 已回款并签发新许可证`,
      });
      window.setTimeout(openLicenseUpdatePrompt, 0);
      return true;
    } catch (cause) {
      notifyRequestError(cause, "测试支付失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
      return false;
    }
  }

  if (!embedded) return null;

  return (
    <>
      <SettingsContentCard
        title="AI员工市场"
        subtitle="浏览运营管理平台上架的 AI 员工，购买权益后安装到当前客户环境。"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex shrink-0 items-center gap-1">
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
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
              <Summary label="商品数量" value={employees.length} />
              <Summary label="已安装" value={installedCount} />
              <Summary label="已安装且授权有效" value={runningCount} />
              <Summary label="已过期" value={expiredCount} />
            </div>
            <div className="ml-auto flex min-w-0 max-w-full items-center gap-3">
              <p className="shrink-0 text-sm text-[var(--color-text-secondary)]">
                {loading ? "正在更新" : `共 ${filtered.length} 位员工`}
              </p>
              <div className="flex min-w-0 max-w-full gap-1 overflow-x-auto pb-1">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
              {filtered.map((employee) => (
                <MySurface
                  className="relative rounded-3xl p-4 shadow-sm transition-[background-color,box-shadow] duration-200 hover:bg-[var(--color-control-soft-hover)] hover:shadow-md motion-reduce:transition-none"
                  key={employee.id}
                >
                  <button
                    type="button"
                    className="absolute inset-0 z-10 cursor-pointer rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                    aria-label={`查看${employee.title}的详细信息`}
                    aria-haspopup="dialog"
                    onClick={() => {
                      setSelectedId(employee.id);
                      setDetailsOpen(true);
                    }}
                  />
                  <div className="relative flex min-w-0 items-center gap-3">
                    <MarketEmployeeAvatar employee={employee} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                        {employee.title}
                      </h3>
                      <p className="mt-1 line-clamp-2 min-h-8 text-xs leading-4 text-[var(--color-text-secondary)]">
                        {employee.description || "暂无员工简介"}
                      </p>
                    </div>
                  </div>
                  <div className="relative mt-3 flex min-w-0 flex-wrap gap-1.5">
                    <OwnershipChip
                      employee={employee}
                      currentTimestamp={currentTimestamp}
                    />
                    <Chip
                      size="sm"
                      color="default"
                      variant="soft"
                      style={{ backgroundColor: "var(--color-control-soft)" }}
                      className="max-w-full truncate"
                    >
                      {employee.installedVersion &&
                      employee.installedVersion !== employee.version
                        ? `v${employee.installedVersion} → v${employee.version}`
                        : employee.installed
                          ? employee.installedVersion
                            ? `v${employee.installedVersion}`
                            : "待同步"
                          : `v${employee.version}`}
                    </Chip>
                  </div>
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
      <Modal isOpen={detailsOpen} onOpenChange={setDetailsOpen}>
        <Modal.Backdrop className="theme-modal-backdrop">
          <Modal.Container placement="center" size="lg">
            <Modal.Dialog className="h-[min(42rem,90dvh)] overflow-hidden rounded-2xl bg-[var(--color-bg-surface)]">
              {selectedEmployee ? (
                <>
                  <Modal.Header className="shrink-0">
                    <div className="flex min-w-0 items-center gap-3">
                      <MarketEmployeeAvatar
                        key={selectedEmployee.id}
                        employee={selectedEmployee}
                      />
                      <Modal.Heading className="min-w-0 break-words">
                        {selectedEmployee.title}
                      </Modal.Heading>
                    </div>
                    <Modal.CloseTrigger aria-label="关闭详情" />
                  </Modal.Header>
                  <Modal.Body className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <Tabs
                      key={selectedEmployee.id}
                      className="min-h-0 flex-1"
                      variant="secondary"
                      defaultSelectedKey="basic"
                      aria-label="AI 员工详情"
                    >
                      <Tabs.ListContainer className="shrink-0">
                        <Tabs.List>
                          <Tabs.Tab id="basic">
                            基础信息
                            <Tabs.Indicator />
                          </Tabs.Tab>
                          <Tabs.Tab id="capabilities">
                            能力
                            <Tabs.Indicator />
                          </Tabs.Tab>
                          <Tabs.Tab id="knowledge">
                            知识库
                            <Tabs.Indicator />
                          </Tabs.Tab>
                        </Tabs.List>
                      </Tabs.ListContainer>
                      <Tabs.Panel id="basic" className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
                        <div className="space-y-4">
                          <section className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-[var(--color-primary-soft)] via-[var(--color-bg-surface)] to-[var(--color-accent-soft)] p-5 shadow-[var(--shadow-sm)]">
                            <FaceRobot aria-hidden="true" className="pointer-events-none absolute -right-5 -top-5 -z-10 h-36 w-36 -rotate-12 text-[var(--color-primary)] opacity-[0.08]" />
                            <div className="mb-5 flex flex-wrap items-center gap-2">
                              <Chip size="sm" variant="soft" color="accent">
                                {selectedEmployee.category || "未分类"}
                              </Chip>
                              <OwnershipChip
                                employee={selectedEmployee}
                                currentTimestamp={currentTimestamp}
                              />
                            </div>
                            <div className="mb-3 flex items-center gap-2">
                              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-primary)] text-white">
                                <FaceRobot aria-hidden="true" className="h-4 w-4" />
                              </span>
                              <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
                                员工简介
                              </h3>
                            </div>
                            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--color-text-secondary)]">
                              {selectedEmployee.description || "暂无员工简介"}
                            </p>
                          </section>

                          <section aria-label="版本与安装" className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
                            <div className="rounded-2xl bg-[var(--color-primary-soft)] p-4 shadow-[var(--shadow-xs)]">
                              <div className="mb-3 flex items-center gap-2 text-[var(--color-primary)]">
                                <ArrowRotateRight aria-hidden="true" className="h-4 w-4" />
                                <h3 className="text-xs font-medium">最新版本</h3>
                              </div>
                              <p className="break-words text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
                                v{selectedEmployee.version}
                              </p>
                              <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                                当前市场发布版本
                              </p>
                            </div>
                            <div className={`rounded-2xl p-4 shadow-[var(--shadow-xs)] ${selectedEmployee.installed ? "bg-[var(--color-success-soft)]" : "bg-[var(--color-control-soft)]"}`}>
                              <div className={`mb-3 flex items-center gap-2 ${selectedEmployee.installed ? "text-[var(--color-success)]" : "text-[var(--color-text-secondary)]"}`}>
                                <ArrowDownToLine aria-hidden="true" className="h-4 w-4" />
                                <h3 className="text-xs font-medium">已安装版本</h3>
                              </div>
                              <p className="break-words text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
                                {selectedEmployee.installed
                                  ? selectedEmployee.installedVersion
                                    ? `v${selectedEmployee.installedVersion}`
                                    : "待同步"
                                  : "未安装"}
                              </p>
                              <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                                {selectedEmployee.installed ? "员工与 Skill 文件已安装" : "安装后即可开始任务"}
                              </p>
                            </div>
                          </section>

                          <section aria-label="价格与授权" className="overflow-hidden rounded-2xl bg-[var(--color-bg-surface)] shadow-[var(--shadow-sm)]">
                            <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--color-accent-soft)] px-5 py-4">
                              <div className="flex items-center gap-2 text-[var(--color-text-primary)]">
                                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--color-bg-surface)] text-[var(--color-accent)]">
                                  <ShoppingCart aria-hidden="true" className="h-4 w-4" />
                                </span>
                                <h3 className="text-sm font-medium">价格与授权</h3>
                              </div>
                              <div className="flex flex-wrap items-baseline gap-2">
                                <span className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
                                  {formatMoney(selectedEmployee.priceCents)}
                                </span>
                                <span className="text-xs text-[var(--color-text-secondary)]">
                                  / {billingText[selectedEmployee.billingCycle] || selectedEmployee.billingCycle}
                                </span>
                              </div>
                            </div>
                            <dl className="px-5 py-4 text-sm">
                              <EmployeeDetail
                                label="授权有效期"
                                value={
                                  selectedEmployee.owned || selectedEmployee.installed
                                    ? selectedEmployee.expiresAt
                                      ? `${formatExpiry(selectedEmployee.expiresAt)}${selectedEmployee.expiresAt < currentTimestamp ? "（已过期）" : ""}`
                                      : "永久有效"
                                    : "未购买"
                                }
                              />
                            </dl>
                          </section>
                        </div>
                      </Tabs.Panel>
                      <Tabs.Panel id="capabilities" className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
                        <section aria-label="员工能力">
                          <h3>allowedTools</h3>
                          {selectedEmployee.allowedTools != null ? (
                            <>
                              <div className="flex flex-wrap gap-2">
                                <Chip
                                  size="sm"
                                  color={
                                    selectedEmployee.allowedTools.includes(
                                      "skill_run_script",
                                    )
                                      ? "success"
                                      : "warning"
                                  }
                                >
                                  脚本运行：
                                  {selectedEmployee.allowedTools.includes(
                                    "skill_run_script",
                                  )
                                    ? "已开放"
                                    : "未开放"}
                                </Chip>
                                <Chip
                                  size="sm"
                                  color={
                                    selectedEmployee.allowedTools.includes(
                                      "workspace_execute_code",
                                    )
                                      ? "success"
                                      : "warning"
                                  }
                                >
                                  代码与终端执行：
                                  {selectedEmployee.allowedTools.includes(
                                    "workspace_execute_code",
                                  )
                                    ? "已开放"
                                    : "未开放"}
                                </Chip>
                              </div>
                              <p>
                                共 {selectedEmployee.allowedTools.length}{" "}
                                项明确能力；依赖安装需要代码与终端执行能力。
                              </p>
                              <MySurface>
                                <pre className="overflow-x-auto whitespace-pre-wrap break-words">
                                  <code>
                                    {JSON.stringify(
                                      {
                                        allowedTools:
                                          selectedEmployee.allowedTools,
                                      },
                                      null,
                                      2,
                                    )}
                                  </code>
                                </pre>
                              </MySurface>
                              {selectedEmployee.allowedTools.length === 0 ? (
                                <p>
                                  当前员工包未配置明确工具能力，仍可使用基础文件与
                                  Skill 资源读取工具。
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <p>
                              {selectedEmployee.installed
                                ? "当前安装包能力信息不可用，请重新同步员工包。"
                                : "尚未安装，安装后可查看实际员工能力。"}
                            </p>
                          )}
                        </section>
                      </Tabs.Panel>
                      <Tabs.Panel id="knowledge" className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
                        <EmployeeKnowledgePanel
                          key={selectedEmployee.id}
                          employeeId={selectedEmployee.id}
                          installed={selectedEmployee.installed}
                          installedVersion={selectedEmployee.installedVersion}
                        />
                      </Tabs.Panel>
                    </Tabs>
                  </Modal.Body>
                  <Modal.Footer className="shrink-0">
                    {selectedEmployee.installed ? (
                      <div className="mt-auto flex justify-end gap-2 pt-3">
                        {selectedEmployee.installedVersion !== selectedEmployee.version ? (
                          <Button
                            size="sm"
                            isPending={syncingId === selectedEmployee.id}
                            isDisabled={
                              !canManage ||
                              Boolean(syncingId) ||
                              Boolean(removingId) ||
                              (selectedEmployee.expiresAt != null &&
                                selectedEmployee.expiresAt < currentTimestamp)
                            }
                            onPress={() => void sync(selectedEmployee)}
                          >
                            <ArrowRotateRight
                              aria-hidden="true"
                              className="h-4 w-4"
                            />
                            更新
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="danger-soft"
                          isPending={removingId === selectedEmployee.id}
                          isDisabled={
                            !canManage ||
                            Boolean(syncingId) ||
                            Boolean(removingId)
                          }
                          onPress={() => void remove(selectedEmployee)}
                        >
                          <TrashBin aria-hidden="true" className="h-4 w-4" />
                          卸载
                        </Button>
                      </div>
                    ) : (
                      <Button
                        isDisabled={!canManage || Boolean(installingId)}
                        isPending={installingId === selectedEmployee.id}
                        onPress={() => {
                          if (selectedEmployee.owned)
                            void install(selectedEmployee);
                          else {
                            setDetailsOpen(false);
                            setPurchase(selectedEmployee);
                          }
                        }}
                      >
                        {selectedEmployee.owned ? (
                          <ArrowDownToLine
                            aria-hidden="true"
                            className="h-4 w-4"
                          />
                        ) : (
                          <ShoppingCart
                            aria-hidden="true"
                            className="h-4 w-4"
                          />
                        )}
                        {selectedEmployee.owned ? "安装" : "购买"}
                      </Button>
                    )}
                  </Modal.Footer>
                </>
              ) : null}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
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

function EmployeeDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="break-words font-medium leading-6 text-[var(--color-text-primary)]">{value}</dd>
    </div>
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
    <div className="flex shrink-0 items-baseline gap-1.5">
      <p className="text-xs text-[var(--color-text-secondary)]">{label}</p>
      <p className="text-sm font-semibold text-[var(--color-text-primary)]">
        {value}
      </p>
    </div>
  );
}

function OwnershipChip({
  employee,
  currentTimestamp,
}: {
  employee: MarketEmployee;
  currentTimestamp: number;
}) {
  if (
    employee.installed &&
    employee.expiresAt != null &&
    employee.expiresAt < currentTimestamp
  )
    return (
      <Chip size="sm" color="danger" variant="soft">
        授权已过期
      </Chip>
    );
  if (
    employee.installed &&
    employee.installedVersion &&
    employee.installedVersion !== employee.version
  )
    return (
      <Chip size="sm" color="warning" variant="soft">
        有新版本
      </Chip>
    );
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
    <Chip
      size="sm"
      color="default"
      variant="soft"
      style={{ backgroundColor: "var(--color-control-soft)" }}
    >
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
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
        <FaceRobot className="h-5 w-5" />
      </span>
    );
  }
  return (
    <Image
      src={src}
      width={56}
      height={56}
      unoptimized
      alt={`${employee.title}头像`}
      className="h-14 w-14 shrink-0 rounded-lg object-cover"
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
