"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Avatar,
  Button,
  Chip,
  EmptyState,
  Modal,
  Table,
  Tooltip,
} from "@heroui/react";
import {
  ArrowDownToLine,
  ArrowRotateRight,
  Eye,
  FaceRobot,
  ShoppingCart,
  TrashBin,
} from "@gravity-ui/icons";
import { notify, notifyRequestError } from "@/shared/lib/notify";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { type Session } from "@/features/agent-v2/client";
import {
  getAiEmployees,
  installMarketAiEmployee,
  uninstallMarketAiEmployee,
} from "@/features/settings/api";
import { SettingsContentCard } from "../components/SettingsContentCard";

import {
  loadEmployeeSessions,
  sumTokenUsage,
  tokenCount,
  tokenStatus,
} from "./session-statistics";

type Employee = import("@/shared/lib/http").AiEmployeeMarketItem;
type EmployeeRow = {
  employee: Employee;
  sessions: Session[];
  latest?: Session;
  tokenUsage: ReturnType<typeof sumTokenUsage>;
};

function dateLabel(value?: string) {
  if (!value) return "暂无调用";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "暂无调用"
    : date.toLocaleString("zh-CN", { hour12: false });
}

export default function AiEmployeesPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("settings.ai-employees.manage");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(
    null,
  );
  const [uninstalling, setUninstalling] = useState<Employee | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [employeeData, sessionData] = await Promise.all([
        getAiEmployees(),
        loadEmployeeSessions(),
      ]);
      setEmployees(
        employeeData.filter((employee) => employee.owned || employee.installed),
      );
      setSessions(sessionData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载 AI 员工数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rows = useMemo<EmployeeRow[]>(() => {
    const grouped = new Map<string, Session[]>();
    for (const session of sessions) {
      const items = grouped.get(session.employee_id) ?? [];
      items.push(session);
      grouped.set(session.employee_id, items);
    }
    return employees.map((employee) => {
      const employeeSessions = grouped.get(employee.id) ?? [];
      const latest = employeeSessions.reduce<Session | undefined>(
        (current, item) =>
          !current || item.updated_at > current.updated_at ? item : current,
        undefined,
      );
      return {
        employee,
        sessions: employeeSessions,
        tokenUsage: sumTokenUsage(employeeSessions),
        latest,
      };
    });
  }, [employees, sessions]);

  const selectedRow = rows.find(
    (row) => row.employee.id === selectedEmployee?.id,
  );
  const selectedSessions = selectedRow?.sessions ?? [];

  const uninstall = async () => {
    if (!uninstalling) return;
    setRemovingId(uninstalling.id);
    try {
      await uninstallMarketAiEmployee(uninstalling.id);
      notify.success("AI 员工已卸载");
      setUninstalling(null);
      setSelectedEmployee(null);
      await load();
    } catch (cause) {
      notifyRequestError(cause, "卸载 AI 员工失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      setRemovingId(null);
    }
  };

  const install = async (employee: Employee) => {
    setInstallingId(employee.id);
    try {
      await installMarketAiEmployee(employee.id);
      notify.success("AI 员工已安装", { description: employee.title });
      await load();
    } catch (cause) {
      notifyRequestError(cause, "安装 AI 员工失败", {
        description: cause instanceof Error ? cause.message : "请稍后重试",
      });
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <SettingsContentCard
      title="AI员工管理"
      subtitle="已拥有员工、版本信息与会话统计"
      bodyClassName="flex min-h-0 flex-col p-0"
      bodyScrollable={false}
      headerActions={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onPress={() => router.push("/market?tab=ai")}
          >
            <ShoppingCart aria-hidden="true" />
            AI员工市场
          </Button>
          <Tooltip>
            <Tooltip.Trigger>
              <Button
                isIconOnly
                variant="secondary"
                aria-label="刷新 AI 员工"
                isDisabled={loading || removingId !== null}
                onPress={() => void load()}
              >
                <ArrowRotateRight aria-hidden="true" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>刷新数据</Tooltip.Content>
          </Tooltip>
          <span className="text-sm font-medium">
            已拥有 {employees.length} 位员工，其中已安装{" "}
            {employees.filter((employee) => employee.installed).length} 位
          </span>
        </div>
      }
    >
      {error ? (
        <Alert status="danger" className="mx-4 mt-3">
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <Table className="min-h-0 flex-1">
        <Table.ScrollContainer className="h-full overflow-auto">
          <Table.Content
            aria-label="已拥有 AI 员工"
            className="min-w-[1160px] w-full"
          >
            <Table.Header>
              <Table.Column id="employee" isRowHeader className="w-[20%]">
                AI 员工
              </Table.Column>
              <Table.Column id="sessions" className="w-[8%]">
                会话数
              </Table.Column>
              <Table.Column id="latest-version" className="w-[8%]">
                最新版本
              </Table.Column>
              <Table.Column id="installed-version" className="w-[8%]">
                已安装版本
              </Table.Column>
              <Table.Column id="state" className="w-[12%]">
                安装状态
              </Table.Column>
              <Table.Column id="installed-at" className="w-[15%]">
                安装时间
              </Table.Column>
              <Table.Column id="latest" className="w-[14%]">
                最近活动
              </Table.Column>
              <Table.Column id="tokens" className="w-[8%]">
                Token 消耗
              </Table.Column>
              <Table.Column id="actions" className="w-[7%]">
                操作
              </Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState>
                  <FaceRobot aria-hidden="true" />
                  <p className="font-medium">
                    {loading ? "正在加载 AI 员工…" : "暂无已拥有的 AI 员工"}
                  </p>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    已购买或已安装的员工及其会话统计会显示在这里。
                  </p>
                </EmptyState>
              )}
            >
              <Table.Collection items={rows}>
                {(row) => (
                  <Table.Row key={row.employee.id} id={row.employee.id}>
                    <Table.Cell>
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar size="sm" className="shrink-0">
                          {row.employee.avatarUrl ? (
                            <Avatar.Image src={row.employee.avatarUrl} alt="" />
                          ) : null}
                          <Avatar.Fallback>
                            {row.employee.title.slice(0, 1) || "AI"}
                          </Avatar.Fallback>
                        </Avatar>
                        <div className="min-w-0">
                          <span className="block truncate font-medium">
                            {row.employee.title}
                          </span>
                          <span className="block truncate text-xs text-[var(--color-text-secondary)]">
                            {row.employee.category} · v
                            {row.employee.installed
                              ? (row.employee.installedVersion ??
                                row.employee.version)
                              : row.employee.version}
                          </span>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-w-8 px-2 tabular-nums"
                        aria-label={`查看${row.employee.title}的会话`}
                        onPress={() => setSelectedEmployee(row.employee)}
                      >
                        {row.sessions.length}
                      </Button>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="font-mono text-xs">
                        v{row.employee.version}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="font-mono text-xs text-[var(--color-text-secondary)]">
                        {row.employee.installedVersion
                          ? `v${row.employee.installedVersion}`
                          : "—"}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={row.employee.installed ? "success" : "accent"}
                      >
                        {row.employee.installed ? "已安装" : "已拥有 · 未安装"}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <time className="text-xs text-[var(--color-text-secondary)]">
                        {row.employee.installedAt
                          ? new Date(
                              row.employee.installedAt * 1000,
                            ).toLocaleString("zh-CN", { hour12: false })
                          : "—"}
                      </time>
                    </Table.Cell>
                    <Table.Cell>
                      <time className="text-xs text-[var(--color-text-secondary)]">
                        {dateLabel(row.latest?.updated_at)}
                      </time>
                    </Table.Cell>
                    <Table.Cell>
                      <Tooltip>
                        <Tooltip.Trigger>
                          <span className="cursor-help text-xs text-[var(--color-text-secondary)]">
                            {row.tokenUsage?.reported_requests
                              ? tokenCount(row.tokenUsage, "total_tokens")
                              : "暂无记录"}
                          </span>
                        </Tooltip.Trigger>
                        <Tooltip.Content>
                          输入 {tokenCount(row.tokenUsage, "input_tokens")} ·
                          输出 {tokenCount(row.tokenUsage, "output_tokens")} ·
                          合计 {tokenCount(row.tokenUsage, "total_tokens")} ·{" "}
                          {tokenStatus(row.tokenUsage)}
                        </Tooltip.Content>
                      </Tooltip>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <Tooltip.Trigger>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              aria-label={`查看${row.employee.title}的会话`}
                              onPress={() => setSelectedEmployee(row.employee)}
                            >
                              <Eye aria-hidden="true" />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>查看会话</Tooltip.Content>
                        </Tooltip>
                        {row.employee.installed ? (
                          <Tooltip>
                            <Tooltip.Trigger>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="ghost"
                                className="text-[var(--color-danger)]"
                                aria-label={`卸载${row.employee.title}`}
                                isDisabled={
                                  !canManage ||
                                  removingId !== null ||
                                  installingId !== null
                                }
                                onPress={() => setUninstalling(row.employee)}
                              >
                                <TrashBin aria-hidden="true" />
                              </Button>
                            </Tooltip.Trigger>
                            <Tooltip.Content>卸载员工</Tooltip.Content>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <Tooltip.Trigger>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="ghost"
                                aria-label={`安装${row.employee.title}`}
                                isDisabled={
                                  !canManage ||
                                  removingId !== null ||
                                  installingId !== null
                                }
                                isPending={installingId === row.employee.id}
                                onPress={() => void install(row.employee)}
                              >
                                <ArrowDownToLine aria-hidden="true" />
                              </Button>
                            </Tooltip.Trigger>
                            <Tooltip.Content>安装员工</Tooltip.Content>
                          </Tooltip>
                        )}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Collection>
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <Modal
        isOpen={selectedEmployee !== null}
        onOpenChange={(open) => !open && setSelectedEmployee(null)}
      >
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center">
            <Modal.Dialog className="w-[min(960px,calc(100vw-2rem))] max-w-none max-h-[85dvh]">
              <Modal.Header>
                <div>
                  <Modal.Heading>
                    {selectedEmployee?.title} · 会话
                  </Modal.Heading>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    当前账号可访问的 {selectedSessions.length} 个未归档会话
                  </p>
                </div>
                <Modal.CloseTrigger aria-label="关闭" />
              </Modal.Header>
              <Modal.Body className="min-h-0 overflow-auto">
                <p
                  className="mb-2 text-sm tabular-nums"
                  aria-label="员工 Token 用量汇总"
                >
                  Token：输入{" "}
                  {tokenCount(selectedRow?.tokenUsage, "input_tokens")} · 输出{" "}
                  {tokenCount(selectedRow?.tokenUsage, "output_tokens")} · 合计{" "}
                  {tokenCount(selectedRow?.tokenUsage, "total_tokens")}（
                  {tokenStatus(selectedRow?.tokenUsage)}）
                </p>
                <p className="mb-4 text-xs text-[var(--color-text-secondary)]">
                  按供应商实际返回的用量累计，包含工具续答及历史摘要；未返回用量的请求无法统计。统计仅包含上述会话，不代表费用或账单。
                </p>
                <Table>
                  <Table.ScrollContainer>
                    <Table.Content
                      aria-label="员工会话明细"
                      className="min-w-[800px]"
                    >
                      <Table.Header>
                        <Table.Column id="title" isRowHeader>
                          会话
                        </Table.Column>
                        <Table.Column id="updated">最近活动</Table.Column>
                        <Table.Column id="input-tokens">
                          输入 Token
                        </Table.Column>
                        <Table.Column id="output-tokens">
                          输出 Token
                        </Table.Column>
                        <Table.Column id="total-tokens">
                          合计 Token
                        </Table.Column>
                        <Table.Column id="usage-status">用量记录</Table.Column>
                      </Table.Header>
                      <Table.Body
                        renderEmptyState={() => (
                          <EmptyState>
                            <p className="font-medium">暂无会话</p>
                            <p className="text-sm text-[var(--color-text-secondary)]">
                              该员工还没有可查看的会话记录。
                            </p>
                          </EmptyState>
                        )}
                      >
                        <Table.Collection items={selectedSessions}>
                          {(session) => (
                            <Table.Row key={session.id} id={session.id}>
                              <Table.Cell>
                                <span
                                  className="block max-w-[360px] truncate"
                                  title={session.title}
                                >
                                  {session.title || "新会话"}
                                </span>
                              </Table.Cell>
                              <Table.Cell>
                                <time className="text-xs text-[var(--color-text-secondary)]">
                                  {dateLabel(session.updated_at)}
                                </time>
                              </Table.Cell>
                              <Table.Cell className="tabular-nums">
                                {tokenCount(
                                  session.token_usage,
                                  "input_tokens",
                                )}
                              </Table.Cell>
                              <Table.Cell className="tabular-nums">
                                {tokenCount(
                                  session.token_usage,
                                  "output_tokens",
                                )}
                              </Table.Cell>
                              <Table.Cell className="tabular-nums">
                                {tokenCount(
                                  session.token_usage,
                                  "total_tokens",
                                )}
                              </Table.Cell>
                              <Table.Cell className="text-xs text-[var(--color-text-secondary)]">
                                {tokenStatus(session.token_usage)}
                              </Table.Cell>
                            </Table.Row>
                          )}
                        </Table.Collection>
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="secondary"
                  onPress={() => setSelectedEmployee(null)}
                >
                  关闭
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal
        isOpen={uninstalling !== null}
        onOpenChange={(open) =>
          !open && removingId === null && setUninstalling(null)
        }
      >
        <Modal.Backdrop
          className="theme-modal-backdrop"
          isDismissable={removingId === null}
        >
          <Modal.Container placement="center">
            <Modal.Dialog className="w-[min(420px,calc(100vw-2rem))] max-w-none">
              <Modal.Header>
                <Modal.Heading>卸载 AI 员工</Modal.Heading>
                <Modal.CloseTrigger
                  aria-label="关闭"
                  isDisabled={removingId !== null}
                />
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  确定卸载「{uninstalling?.title}
                  」吗？卸载后该员工将无法继续使用。
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="secondary"
                  isDisabled={removingId !== null}
                  onPress={() => setUninstalling(null)}
                >
                  取消
                </Button>
                <Button
                  variant="danger"
                  isPending={removingId !== null}
                  isDisabled={!canManage || removingId !== null}
                  onPress={() => void uninstall()}
                >
                  卸载
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </SettingsContentCard>
  );
}
