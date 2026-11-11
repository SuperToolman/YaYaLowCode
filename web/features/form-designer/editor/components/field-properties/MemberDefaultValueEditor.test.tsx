import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemberDefaultValueEditor } from "./MemberDefaultValueEditor";
import { fetchRuntimeIdentityCatalog } from "@/features/form-runtime/api";
import { buildSchema, getDefaultPageDesignerProps, normalizeDesignerFields } from "../../designer-schema";
import type { PlacedField } from "../../designer-types";

vi.mock("@/features/form-runtime/api", () => ({ fetchRuntimeIdentityCatalog: vi.fn() }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchRuntimeIdentityCatalog).mockResolvedValue({ users: [
    { id: "a", displayName: "张三", status: "active", sourceType: "local", avatarUrl: null, jobNumber: "001", roles: [] },
    { id: "b", displayName: "李四", status: "active", sourceType: "local", avatarUrl: null, jobNumber: "002", roles: [] },
  ], roles: [] });
});

function Harness({ multiple = false }: { multiple?: boolean }) {
  const [field, setField] = useState<PlacedField>({ id: "member", type: "member", label: "成员", row: 0, column: 0, rowSpan: 1, colSpan: 1,
    props: { defaultValueType: "none", memberMultiple: multiple, memberOrganizationSource: "local" } });
  const saved = buildSchema("form", "表单", [field], getDefaultPageDesignerProps());
  return <><MemberDefaultValueEditor field={field} onPropsChange={(_, props) => setField((current) => ({ ...current, props: { ...current.props, ...props } }))} />
    <output data-testid="saved">{JSON.stringify(normalizeDesignerFields(saved.fields)[0].props)}</output></>;
}

it("仅提供三种成员默认值类型，当前登录人不渲染额外设置", () => {
  render(<Harness />);
  expect(screen.queryByText("公式")).toBeNull();
  expect(screen.queryByText("联动")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "当前登录人" }));
  expect(screen.queryByRole("button", { name: "选择成员" })).toBeNull();
  expect(fetchRuntimeIdentityCatalog).not.toHaveBeenCalled();
  expect(JSON.parse(screen.getByTestId("saved").textContent!).defaultValueType).toBe("currentUser");
});

it.each([false, true])("自定义复用全局成员选择器并保存成员 ID（多选 %s）", async (multiple) => {
  render(<Harness multiple={multiple} />);
  fireEvent.click(screen.getByRole("radio", { name: "自定义" }));
  await waitFor(() => expect(fetchRuntimeIdentityCatalog).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText("正在加载成员…")).toBeNull());
  expect(screen.queryByRole("textbox", { name: "默认值" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "选择成员" }));
  const member = await screen.findByRole("checkbox", { name: /张三/ });
  fireEvent.click(member);
  await waitFor(() => expect(JSON.parse(screen.getByTestId("saved").textContent!).defaultValue).toEqual(multiple ? ["a"] : "a"));
  if (multiple) {
    fireEvent.keyDown(screen.getByRole("dialog", { name: "选择成员" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "选择成员" })).toBeNull());
  }
  fireEvent.click(screen.getByRole("radio", { name: "无" }));
  expect(JSON.parse(screen.getByTestId("saved").textContent!).defaultValueType).toBe("none");
  expect(JSON.parse(screen.getByTestId("saved").textContent!)).not.toHaveProperty("defaultValue");
});
