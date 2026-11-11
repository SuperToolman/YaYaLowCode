import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeFormRenderer } from "./RuntimeFormRenderer";
import { formatReadOnlyValue } from "./RuntimeReadOnlyForm";
import { fetchAssociationRecords, fetchRuntimeIdentityCatalog } from "../api";
import type { RuntimeFormSchema, RuntimeSchemaField } from "../../form-model/runtime-types";

vi.mock("@/features/auth/components/AuthProvider", () => ({ useAuth: () => ({ user: { id: "viewer" }, token: "session", permissions: [] }) }));
vi.mock("../api", () => ({ fetchRuntimeIdentityCatalog: vi.fn(), fetchAssociationRecords: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const field = (id: string, type: RuntimeSchemaField["type"] = "singleLineText", props: RuntimeSchemaField["props"] = {}): RuntimeSchemaField => ({ id, label: id, type, row: 0, column: 0, props });
const schema = (fields: RuntimeSchemaField[]): RuntimeFormSchema => ({ formUuid: "readonly-test", columns: 6, rows: 10, fields });

it("按钮查看模式执行实际 didMount 脚本并接收 URL 参数，保持无编辑控件且不保存", async () => {
  const form = schema([field("customer"), field("alias")]);
  form.pageProps = { actionPanel: { code: "function didMount(ctx) { ctx.helpers.setFieldValue('customer', ctx.urlParams.customerCode); ctx.helpers.setFieldValue('alias', ctx.state.urlParams.customerCode); }" } };
  const onSubmit = vi.fn();
  const { container } = render(<RuntimeFormRenderer schema={form} initialValues={{ customer: "old" }} readOnlyDisplay runLoadActionInReadOnly urlParams={{ customerCode: "客户001" }} onSubmit={onSubmit} submitLabel="保存" />);
  await waitFor(() => expect(screen.getByLabelText("customer").textContent).toBe("客户001"));
  expect(screen.getByLabelText("alias").textContent).toBe("客户001");
  expect(container.querySelector("input,textarea,select,[contenteditable=true]")).toBeNull();
  expect(screen.queryByText("保存")).toBeNull();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("编辑模式的实际加载脚本同样收到两种 URL 参数上下文", async () => {
  const form = schema([field("customer"), field("alias")]);
  form.formUuid = "parameter-edit-test";
  form.pageProps = { actionPanel: { code: "function didMount(ctx) { ctx.helpers.setFieldValue('customer', ctx.urlParams.customerCode); ctx.helpers.setFieldValue('alias', ctx.state.urlParams.customerCode); }" } };
  render(<RuntimeFormRenderer schema={form} urlParams={{ customerCode: "C-EDIT" }} onSubmit={() => {}} submitLabel="保存" />);
  await waitFor(() => expect((screen.getByRole("textbox", { name: "customer" }) as HTMLInputElement).value).toBe("C-EDIT"));
  expect((screen.getByRole("textbox", { name: "alias" }) as HTMLInputElement).value).toBe("C-EDIT");
});

it.each([undefined, null, []])("查看模式空子表保留表头并使用 Table Empty State（%j）", (value) => {
  const form = schema([field("sub", "subform"), { ...field("商品名称"), parentGroupId: "sub" }]);
  const { container } = render(<RuntimeFormRenderer schema={form} initialValues={{ sub: value }} readOnlyDisplay submitLabel="提交" onSubmit={() => undefined} />);
  expect(screen.getByRole("grid", { name: "子表单数据" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "商品名称" })).toBeTruthy();
  expect(screen.getByText("暂无子表单数据")).toBeTruthy();
  expect(screen.getByText("共 0 行")).toBeTruthy();
  expect(screen.queryByText(/开始填写/)).toBeNull();
  expect(container.querySelector("input,textarea,iframe")).toBeNull();
});

it("静态只读直接显示已存值，不挂载编辑器、不执行脚本或补齐默认值", () => {
  const onValuesChange = vi.fn(), onSubmit = vi.fn();
  const form = schema([field("text"), field("empty", "singleLineText", { defaultValue: "不应补齐", defaultValueType: "custom" }), field("rich", "richText"), field("custom", "tsx", { code: "throw new Error('不应执行')" }), field("hidden", "singleLineText", { isHidden: true })]);
  form.pageProps = { actionPanel: { code: "throw new Error('不应编译')" } };
  const { container } = render(<RuntimeFormRenderer schema={form} initialValues={{ text: "保存值", rich: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "富文本内容" }] }] }, hidden: "隐藏内容" }} readOnlyDisplay onValuesChange={onValuesChange} onSubmit={onSubmit} submitLabel="提交" />);
  expect(screen.getByLabelText("text").textContent).toBe("保存值");
  expect(screen.getByLabelText("empty").textContent).toBe("-");
  expect(screen.getByLabelText("rich").textContent).toBe("富文本内容");
  expect(screen.queryByText("隐藏内容")).toBeNull();
  expect(container.querySelector("input,textarea,select,iframe,[contenteditable=true]")).toBeNull();
  expect(onValuesChange).not.toHaveBeenCalled();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("0、false、空白、选项、日期区间、附件与富文本安全文本转换", () => {
  expect(formatReadOnlyValue(field("n", "number"), 0)).toBe("0");
  expect(formatReadOnlyValue(field("b", "radio"), false)).toBe("否");
  for (const empty of [null, undefined, "  ", [], [""]]) expect(formatReadOnlyValue(field("e"), empty)).toBe("-");
  expect(formatReadOnlyValue(field("s", "select", { options: [{ value: "a", label: "选项甲" }] }), "a")).toBe("选项甲");
  expect(formatReadOnlyValue(field("d", "dateRange"), ["2026-01-01", "2026-02-01"])).toBe("2026-01-01 至 2026-02-01");
  expect(formatReadOnlyValue(field("f", "attachment"), [{ fileId: "file", name: "文件.pdf" }])).toBe("文件.pdf");
  expect(formatReadOnlyValue(field("r", "richText"), { type: "doc", content: [] })).toBe("-");
});

it("成员和关联共享表单级标签查询，不显示为编辑器", async () => {
  vi.mocked(fetchRuntimeIdentityCatalog).mockResolvedValue({ users: [{ id: "u", displayName: "成员甲", avatarUrl: null, jobNumber: null, roles: [], sourceType: "local", status: "active" }], roles: [] });
  vi.mocked(fetchAssociationRecords).mockResolvedValue([{ id: "r", createdAt: "", data: { title: "关联甲" } }]);
  const form = schema([field("m1", "member"), field("m2", "member"), field("a1", "associationFormField", { associationFormId: "form", associationPrimaryFieldId: "title" }), field("a2", "associationFormField", { associationFormId: "form", associationPrimaryFieldId: "title" })]);
  render(<RuntimeFormRenderer schema={form} initialValues={{ m1: "u", m2: ["u"], a1: "r", a2: "r" }} readOnlyDisplay submitLabel="提交" onSubmit={() => undefined} />);
  await waitFor(() => expect(screen.getByLabelText("m1").textContent).toBe("成员甲"));
  expect(screen.getByLabelText("a2").textContent).toBe("关联甲");
  expect(fetchRuntimeIdentityCatalog).toHaveBeenCalledTimes(1);
  expect(fetchAssociationRecords).toHaveBeenCalledTimes(1);
});

it("嵌套分组和子表保留分页，外部补丁更新文本，切换编辑才挂载控件", async () => {
  const form = schema([field("group", "groupContainer"), { ...field("sub", "subform", { subformPageSize: 20 }), parentGroupId: "group" }, { ...field("cell"), parentGroupId: "sub" }, field("main")]);
  const values = { main: "主表", sub: Array.from({ length: 21 }, (_, i) => ({ cell: `第${i + 1}行` })) };
  const props = { schema: form, initialValues: values, submitLabel: "提交", onSubmit: () => undefined };
  const { container, rerender } = render(<RuntimeFormRenderer {...props} readOnlyDisplay />);
  expect(screen.getByText("第1行")).toBeTruthy();
  expect(screen.queryByText("第21行")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getByText("第21行")).toBeTruthy();
  expect(container.querySelector("input,textarea,iframe")).toBeNull();
  rerender(<RuntimeFormRenderer {...props} readOnlyDisplay valuePatch={{ id: 1, values: { main: "补丁值" } }} />);
  expect(screen.getByLabelText("main").textContent).toBe("补丁值");
  rerender(<RuntimeFormRenderer {...props} />);
  await waitFor(() => expect(screen.getByRole("textbox", { name: "main" })).toBeTruthy());
});
