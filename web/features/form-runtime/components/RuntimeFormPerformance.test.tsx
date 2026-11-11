import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeFormRenderer } from "./RuntimeFormRenderer";
import type { RuntimeFormSchema, RuntimeSchemaField } from "../../form-model/runtime-types";
import * as formulas from "@/features/form-runtime/model/form-formula";
import { RuntimeTransactionContext } from "./runtime-form-transaction";

const renders = vi.hoisted(() => new Map<string, number>());
vi.mock("@/features/auth/components/AuthProvider", () => ({ useAuth: () => ({ user: { id: "user" } }) }));
vi.mock("./RuntimeMemberSelect", () => ({
  RuntimeMemberSelect: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => {
    const id = String(value).split(":")[0];
    renders.set(id, (renders.get(id) ?? 0) + 1);
    return <input aria-label={id} value={value} onChange={(event) => onChange(event.target.value)} />;
  },
}));
vi.mock("./RuntimeAssociationField", () => ({
  AssociationDefaultsContext: React.createContext(false),
  RuntimeAssociationField: ({ onChange, onFill }: { onChange: (value: unknown) => void; onFill: (source: Record<string, unknown>) => void }) => {
    const transaction = React.useContext(RuntimeTransactionContext);
    return <button type="button" onClick={() => transaction(() => { onChange("record"); onFill({ amount: 7 }); })}>选择关联测试记录</button>;
  },
}));
afterEach(() => { cleanup(); renders.clear(); vi.restoreAllMocks(); });

it.each([50, 150, 300])("%i 个字段的输入只更新目标编辑器", async (count) => {
  const schema: RuntimeFormSchema = { formUuid: `perf-${count}`, columns: 6, rows: count, fields:
    Array.from({ length: count }, (_, index) => ({
      id: `f${index}`, type: "member", label: `字段${index}`, row: index, column: 0,
      props: { defaultValueType: "none" },
    })),
  };
  const initialValues = Object.fromEntries(schema.fields.map((field) => [field.id, `${field.id}:initial`]));
  const onValuesChange = vi.fn();
  render(<RuntimeFormRenderer schema={schema} initialValues={initialValues} onValuesChange={onValuesChange} submitLabel="提交" onSubmit={() => undefined} />);
  renders.clear();
  fireEvent.change(screen.getByLabelText("f0"), { target: { value: "f0:changed" } });
  await waitFor(() => expect(onValuesChange).toHaveBeenLastCalledWith({ ...initialValues, f0: "f0:changed" }));
  const unrelated = [...renders.entries()].filter(([id]) => id !== "f0").reduce((sum, [, count]) => sum + count, 0);
  console.info(JSON.stringify({ fields: count, targetRenders: renders.get("f0"), unrelatedEditorRenders: unrelated }));
  expect(unrelated).toBe(0);
}, 30000);

function field(id: string, props: RuntimeSchemaField["props"] = {}): RuntimeSchemaField {
  return { id, type: "member", label: id, row: 0, column: 0, props };
}

it("嵌套分组的输入不刷新 299 个无关编辑器", async () => {
  const fields = Array.from({ length: 300 }, (_, index) => ({ ...field(`f${index}`), parentGroupId: index < 150 ? "outer" : "inner", row: index }));
  const schema: RuntimeFormSchema = { formUuid: "groups", columns: 6, rows: 300, fields: [
    { ...field("outer"), type: "groupContainer", rowSpan: 300, colSpan: 6 },
    { ...field("inner"), type: "groupContainer", parentGroupId: "outer", rowSpan: 150, colSpan: 6, row: 150 }, ...fields,
  ] };
  const initialValues = Object.fromEntries(fields.map((f) => [f.id, `${f.id}:initial`]));
  const onSubmit = vi.fn();
  render(<RuntimeFormRenderer schema={schema} initialValues={initialValues} submitLabel="提交" onSubmit={onSubmit} />);
  renders.clear();
  fireEvent.change(screen.getByLabelText("f200", { selector: "input" }), { target: { value: "f200:changed" } });
  expect([...renders.keys()]).toEqual(["f200"]);
  fireEvent.click(screen.getByRole("button", { name: "提交" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ ...initialValues, f200: "f200:changed" }));
}, 30000);

it("20×20 子表编辑只执行目标编辑器，翻页与删除后仍编辑正确行", async () => {
  const children = Array.from({ length: 20 }, (_, index) => ({ ...field(`c${index}`), parentGroupId: "sub", column: index }));
  const rows = Array.from({ length: 21 }, (_, row) => Object.fromEntries(children.map((f) => [f.id, `r${row}_${f.id}:initial`])));
  const schema: RuntimeFormSchema = { formUuid: "subform", columns: 6, rows: 1, fields: [
    { ...field("sub", { subformPageSize: 20, subformButtonState: "normal" }), type: "subform", colSpan: 6 }, ...children,
  ] };
  const onValuesChange = vi.fn();
  render(<RuntimeFormRenderer schema={schema} initialValues={{ sub: rows }} submitLabel="提交" onSubmit={() => undefined} onValuesChange={onValuesChange} />);
  renders.clear();
  fireEvent.change(screen.getByLabelText("r0_c0"), { target: { value: "r0_c0:changed" } });
  expect([...renders.keys()]).toEqual(["r0_c0"]);
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  fireEvent.change(screen.getByLabelText("r20_c0"), { target: { value: "r20_c0:changed" } });
  await waitFor(() => expect(onValuesChange.mock.lastCall?.[0].sub[20].c0).toBe("r20_c0:changed"));
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  expect(screen.getByLabelText("r0_c0")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("r1_c0"), { target: { value: "r1_c0:changed" } });
  expect(onValuesChange.mock.lastCall?.[0].sub).toHaveLength(20);
  expect(onValuesChange.mock.lastCall?.[0].sub[1].c0).toBe("r1_c0:changed");
}, 60000);

it("脚本多字段写入、公式联动与补丁在同一完整快照中通知", async () => {
  const schema: RuntimeFormSchema = { formUuid: "actions", columns: 6, rows: 1, fields: [
    field("a"), { ...field("b"), type: "number" }, { ...field("c"), type: "number" },
    { ...field("sum", { defaultValueType: "formula", defaultValueFormula: "$b+$c" }), type: "number" },
  ], pageProps: { actionPanel: { code: 'function onFieldEvent(ctx) { if(ctx.fieldId === "a") { ctx.values.b = 5; ctx.helpers.setFieldValue("c", 7); } }' } } };
  const onValuesChange = vi.fn(); const onSubmit = vi.fn();
  const props = { schema, initialValues: { a: "a:initial", b: 1, c: 2 }, onValuesChange, onSubmit, submitLabel: "提交" };
  const { rerender } = render(<RuntimeFormRenderer {...props} />);
  onValuesChange.mockClear();
  fireEvent.change(screen.getByLabelText("a", { selector: "input" }), { target: { value: "a:changed" } });
  expect(onValuesChange).toHaveBeenCalledTimes(1);
  expect(onValuesChange).toHaveBeenLastCalledWith({ a: "a:changed", b: 5, c: 7, sum: 12 });
  rerender(<RuntimeFormRenderer {...props} valuePatch={{ id: 1, values: { b: 10 } }} />);
  await waitFor(() => expect(onValuesChange).toHaveBeenLastCalledWith({ a: "a:changed", b: 10, c: 7, sum: 17 }));
  fireEvent.click(screen.getByRole("button", { name: "提交" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ a: "a:changed", b: 10, c: 7, sum: 17 }));
});

it("提交后的错误变化不刷新无关编辑器", () => {
  const schema: RuntimeFormSchema = { formUuid: "errors", columns: 6, rows: 1, fields: [
    { ...field("required", { isRequired: true }), type: "singleLineText" }, field("other"),
  ] };
  render(<RuntimeFormRenderer schema={schema} initialValues={{ other: "other:initial" }} submitLabel="提交" onSubmit={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "提交" }));
  expect(screen.getByText("请填写required")).toBeTruthy();
  renders.clear();
  fireEvent.change(screen.getByRole("textbox", { name: "required" }), { target: { value: "ok" } });
  expect(screen.queryByText("请填写required")).toBeNull();
  expect(renders.size).toBe(0);
});

it("关联选择与回填只求值一次公式、通知一次完整快照", () => {
  const schema: RuntimeFormSchema = { formUuid: "association-transaction", columns: 6, rows: 1, fields: [
    { ...field("association", { associationFills: [{ sourceFieldId: "amount", targetFieldId: "amount" }] }), type: "associationFormField" },
    { ...field("amount"), type: "number" },
    { ...field("total", { defaultValueType: "formula", defaultValueFormula: "$amount*2" }), type: "number" },
  ] };
  const onValuesChange = vi.fn();
  render(<RuntimeFormRenderer schema={schema} initialValues={{ amount: 1 }} onValuesChange={onValuesChange} submitLabel="提交" onSubmit={() => undefined} />);
  const calculate = vi.spyOn(formulas, "calculateFormulaValues");
  onValuesChange.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "选择关联测试记录" }));
  expect(calculate).toHaveBeenCalledTimes(1);
  expect(onValuesChange).toHaveBeenCalledTimes(1);
  expect(onValuesChange).toHaveBeenLastCalledWith({ association: "record", amount: 7, total: 14 });
});
