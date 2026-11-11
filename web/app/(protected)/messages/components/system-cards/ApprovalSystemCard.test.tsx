import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApprovalSystemCard } from "./ApprovalSystemCard";

const { notifySuccess, notifyError, getFormSchema, queryFormRecords } = vi.hoisted(() => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  getFormSchema: vi.fn(),
  queryFormRecords: vi.fn(),
}));

vi.mock("@/shared/lib/http", () => ({ getFormSchema, queryFormRecords }));
vi.mock("@/features/auth/components/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined, refetch: vi.fn() }) }));

vi.mock("@/features/form-runtime/components", () => ({
  RuntimeFormSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  RuntimeFormRenderer: ({ schema, initialValues, isReadOnly }: { schema: { formName?: string }; initialValues: Record<string, unknown>; isReadOnly?: boolean }) => (
    <div data-testid="runtime-form" data-readonly={isReadOnly}>
      {schema.formName}:{String(initialValues.subject)}
    </div>
  ),
}));

vi.mock("@/shared/lib/notify", () => ({
  notify: { success: (...args: unknown[]) => notifySuccess(...args) },
  notifyRequestError: (...args: unknown[]) => notifyError(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  queryFormRecords.mockResolvedValue({
    data: {
      code: 0,
      message: "ok",
      data: {
        items: [{
          id: "record-1",
          data: { subject: "采购 20 台显示器" },
          createdBy: "张三",
          createdAt: "2026-10-22T10:00:00Z",
          schemaVersion: 4,
        }],
      },
    },
  });
  getFormSchema.mockResolvedValue({
    data: { code: 0, message: "ok", data: { schema: { formName: "采购申请", fields: [] } } },
  });
});

queryFormRecords.mockResolvedValue({
  data: {
    code: 0,
    message: "ok",
    data: {
      items: [{
        id: "record-1",
        data: { subject: "采购 20 台显示器" },
        createdBy: "张三",
        createdAt: "2026-10-22T10:00:00Z",
        schemaVersion: 4,
      }],
    },
  },
});
getFormSchema.mockResolvedValue({
  data: { code: 0, message: "ok", data: { schema: { formName: "采购申请", fields: [] } } },
});

const card = {
  cardType: "approval",
  appId: "app-1",
  formUuid: "form-1",
  formName: "采购申请",
  flowName: "采购审批",
  submitter: "张三",
  startedAt: "2026-10-22T10:00:00Z",
  task: { nodeLabel: "部门负责人审批" },
  recordUuid: "record-1",
  taskUuid: "task-1",
  actions: [
    { id: "approve", label: "同意" },
    { id: "reject", label: "拒绝" },
  ],
};

it("disables duplicate actions while submitting and reports success", async () => {
  let finishAction!: () => void;
  const onApprovalAction = vi.fn(
    () => new Promise<void>((resolve) => { finishAction = resolve; }),
  );
  render(
    <ApprovalSystemCard
      card={card}
      onApprovalAction={onApprovalAction}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
  expect((screen.getByRole("button", { name: "同意" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "处理中…" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finishAction());

  expect((screen.getByRole("button", { name: "同意" }) as HTMLButtonElement).disabled).toBe(false);
  expect(onApprovalAction).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith("已拒绝审批"));
});

it("opens an in-place drawer and renders the full record with the runtime engine", async () => {
  render(
    <ApprovalSystemCard card={card} onApprovalAction={vi.fn()} />,
  );

  expect(screen.getByText("采购申请")).not.toBeNull();
  expect(screen.getByText("采购审批")).not.toBeNull();
  expect(screen.getByText("张三")).not.toBeNull();
  expect(screen.getByText("部门负责人审批")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看表单详情" }));
  expect((await screen.findByTestId("runtime-form")).textContent).toContain("采购申请:采购 20 台显示器");
  expect(screen.getByTestId("runtime-form").getAttribute("data-readonly")).toBe("true");
  expect(screen.getByRole("button", { name: "关闭" })).not.toBeNull();
  expect(queryFormRecords).toHaveBeenCalledWith(expect.objectContaining({
    path: { formUuid: "form-1" },
    body: expect.objectContaining({
      filters: [{ fieldId: "id", operator: "eq", value: "record-1" }],
    }),
  }));
  expect(getFormSchema).toHaveBeenCalledWith(expect.objectContaining({
    path: { formUuid: "form-1" },
    query: { version: 4 },
  }));
});

it("keeps the full card context and detail entry after a persisted result", () => {
  render(
    <ApprovalSystemCard
      card={{ ...card, result: "approved" }}
      onApprovalAction={vi.fn()}
    />,
  );

  expect(screen.getByRole("status").textContent).toContain("已同意审批任务");
  expect(screen.getByText("采购申请")).not.toBeNull();
  expect(screen.getByText("采购审批")).not.toBeNull();
  expect(screen.getByRole("button", { name: "查看表单详情" })).not.toBeNull();
  expect(screen.queryByRole("button", { name: "同意" })).toBeNull();
  expect(screen.queryByRole("button", { name: "拒绝" })).toBeNull();
});
