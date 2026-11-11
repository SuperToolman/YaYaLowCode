import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldValueInput } from "./AutomationNodeConfigPrimitives";

vi.mock("@/features/form-runtime/components/RuntimeFormRenderer", () => ({
  FormField: ({ field, value, onFieldAction }: {
    field: { id: string };
    value: unknown;
    onFieldAction: (id: string, value: unknown) => void;
  }) => (
    <input
      aria-label="通用字段值"
      value={typeof value === "string" ? value : JSON.stringify(value ?? "")}
      onChange={(event) => onFieldAction(field.id, JSON.parse(event.currentTarget.value))}
    />
  ),
}));

vi.mock("@/features/form-runtime/components/RuntimeAssociationField", () => ({
  RuntimeAssociationField: ({ value, onChange }: {
    value: unknown;
    onChange: (value: string) => void;
  }) => (
    <select aria-label="关联记录" value={String(value ?? "")} onChange={(event) => onChange(event.currentTarget.value)}>
      <option value="">选择记录</option>
      <option value="record-1">测试记录</option>
    </select>
  ),
}));

afterEach(cleanup);

describe("automation field value input", () => {
  it("uses the association record selector and stores the selected record ID", () => {
    const onChange = vi.fn();
    render(<FieldValueInput
      field={{ id: "related", label: "关联记录", type: "associationFormField", isRequired: false, options: [], props: { associationFormId: "form-1" } }}
      value=""
      onChange={onChange}
    />);

    fireEvent.change(screen.getByRole("combobox", { name: "关联记录" }), { target: { value: "record-1" } });

    expect(onChange).toHaveBeenCalledWith("record-1");
    expect(screen.queryByRole("textbox", { name: "通用字段值" })).toBeNull();
  });

  it("hydrates and writes a structured country and region value", () => {
    const onChange = vi.fn();
    const value = { code: "CN-11", name: "北京", path: [] };
    const view = render(<FieldValueInput
      field={{ id: "region", label: "国家/地区", type: "countryCity", isRequired: false, options: [] }}
      value={JSON.stringify(value)}
      onChange={onChange}
    />);

    expect((screen.getByRole("textbox", { name: "通用字段值" }) as HTMLInputElement).value).toBe(JSON.stringify(value));
    fireEvent.change(screen.getByRole("textbox", { name: "通用字段值" }), { target: { value: JSON.stringify({ code: "CN-31", name: "上海", path: [] }) } });

    expect(onChange).toHaveBeenCalledWith(`__yaya_json_value_v1__:${JSON.stringify({ code: "CN-31", name: "上海", path: [] })}`);
    view.unmount();
  });
});
