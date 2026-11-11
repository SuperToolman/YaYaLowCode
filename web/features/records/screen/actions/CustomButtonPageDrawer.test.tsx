import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { CustomButtonPageDrawer, type CustomButtonPageTarget } from "./CustomButtonPageDrawer";
import { EmbeddedRecordsPageContext } from "../embedded-page-context";
import { emptyDraft } from "@/features/custom-buttons/model";
import { fetchCurrentFormSchema } from "@/features/form-runtime/api";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(() => true),
  create: vi.fn(),
  update: vi.fn(),
  renderer: vi.fn(),
  page: vi.fn(),
}));
function EmbeddedPage(props: { appId: string; formUuid: string; embedded?: boolean; readOnly?: boolean }) {
  mocks.page(props);
  return <div>暂无数据</div>;
}
function renderEmbeddedPage(props: React.ComponentProps<typeof EmbeddedPage>) {
  return <EmbeddedPage {...props} />;
}
vi.mock("@heroui/react", () => {
  const Part = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Drawer: Object.assign(Part, { Backdrop: Part, Content: Part, Dialog: Part, Header: Part, Heading: Part, CloseTrigger: () => null, Body: Part }), Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => <button onClick={onPress}>{children}</button> };
});
vi.mock("@/features/auth/components/AuthProvider", () => ({ useAuth: () => ({ hasPermission: mocks.permission }) }));
vi.mock("@/shared/lib/notify", () => ({ notify: { success: vi.fn() }, notifyRequestError: vi.fn() }));
vi.mock("@/features/form-runtime/api", () => ({ fetchCurrentFormSchema: vi.fn() }));
vi.mock("@/features/records/mutations", () => ({ useRecordMutations: () => ({ create: { isPending: false, mutateAsync: mocks.create }, update: { isPending: false, mutateAsync: mocks.update } }) }));
vi.mock("@/features/form-runtime/components/RuntimeFormRenderer", () => ({ RuntimeFormRenderer: (props: { readOnlyDisplay: boolean; onSubmit: (values: Record<string, unknown>) => void }) => {
  mocks.renderer(props);
  return <div data-testid="form">{props.readOnlyDisplay ? "只读表单" : <button onClick={() => props.onSubmit({ name: "更新值" })}>保存表单</button>}</div>;
} }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

function setup(options: { external?: boolean; edit?: boolean; denied?: boolean; record?: boolean; failed?: boolean } = {}) {
  mocks.permission.mockReturnValue(!options.denied);
  const schema = { formUuid: "target", columns: 6, rows: 10, fields: [] };
  if (options.failed) vi.mocked(fetchCurrentFormSchema).mockRejectedValue(new Error("无权访问目标表单"));
  else vi.mocked(fetchCurrentFormSchema).mockResolvedValue(schema);
  const target: CustomButtonPageTarget = {
    button: { ...emptyDraft(), id: "button", appId: "app", formUuid: "source", createdAt: "", updatedAt: "", name: "客户动态", actionType: "open_page", actionConfig: { targetAppId: "app", targetFormUuid: "target", fieldIds: [], linkType: options.external ? "external" : "internal", pageMode: options.edit ? "edit" : "view", openMode: "sidebar" } },
    url: options.external ? "https://example.com?customerCode=C001#section" : `/app/target?buttonPageMode=${options.edit ? "edit" : "view"}&customerCode=C001`,
    record: options.record ? { id: "record", data: { name: "已保存值" } } : undefined,
  };
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(<QueryClientProvider client={client}><EmbeddedRecordsPageContext.Provider value={renderEmbeddedPage}><CustomButtonPageDrawer target={target} onClose={onClose} /></EmbeddedRecordsPageContext.Provider></QueryClientProvider>);
  return { ...result, onClose, schema };
}

it("跨表单查看渲染目标数据页面，即使字段为空也展示数据空状态", async () => {
  const { container } = setup();
  await screen.findByText("暂无数据");
  expect(container.querySelector("iframe")).toBeNull();
  expect(mocks.page).toHaveBeenLastCalledWith({ appId: "app", formUuid: "target", embedded: true, readOnly: true, pageParameters: { appId: "app", formUuid: "target", buttonPageMode: "view", customerCode: "C001" } });
  expect(mocks.renderer).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});

it("当前表单编辑复用记录值并更新原记录", async () => {
  const { onClose } = setup({ edit: true, record: true });
  fireEvent.click(await screen.findByText("保存表单"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(mocks.renderer).toHaveBeenCalledWith(expect.objectContaining({ initialValues: { name: "已保存值" }, recordUuid: "record" }));
  expect(mocks.update).toHaveBeenCalledWith({ recordUuid: "record", values: { name: "更新值" } });
  expect(mocks.create).not.toHaveBeenCalled();
});

it("跨表单编辑使用目标数据页面，保留页面的记录选择与编辑流程", async () => {
  setup({ edit: true });
  await screen.findByText("暂无数据");
  expect(mocks.page).toHaveBeenLastCalledWith({ appId: "app", formUuid: "target", embedded: true, readOnly: false, pageParameters: { appId: "app", formUuid: "target", buttonPageMode: "edit", customerCode: "C001" } });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});

it("缺少写权限时只显示只读表单", async () => {
  setup({ edit: true, denied: true, record: true });
  await screen.findByText("只读表单");
  expect(screen.queryByText("保存表单")).toBeNull();
});

it("加载失败显示错误，不回退到 iframe", async () => {
  const { container } = setup({ failed: true, record: true });
  expect((await screen.findByRole("alert")).textContent).toBe("无权访问目标表单");
  expect(container.querySelector("iframe")).toBeNull();
  expect(mocks.renderer).not.toHaveBeenCalled();
});

it("外部链接保留独立网页展示", () => {
  const { container } = setup({ external: true });
  expect(container.querySelector("iframe")?.getAttribute("src")).toBe("https://example.com?customerCode=C001#section");
  expect(fetchCurrentFormSchema).not.toHaveBeenCalled();
});
