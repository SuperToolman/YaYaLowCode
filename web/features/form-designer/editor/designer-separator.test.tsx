import { cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompTool, getDefaultDesignerFieldProps } from "./components/CompTool";
import { FieldPropertyPanel } from "./components/field-properties/FieldPropertyDrawer";
import { getComponentResizeCapabilities, getInitialFieldLayout, moveField, planFieldInsertion } from "./designer-layout";
import { placeToolboxField } from "./designer-toolbox";
import { placePastedFields } from "./designer-clipboard";
import { buildSchema, getDefaultPageDesignerProps } from "./designer-schema";
import { decodeStoredDesignerSchema, parseDesignerSource } from "./designer-source";
import { getAssociationMainTableFields } from "./association-fill-fields";
import { createHistory, commitHistory, undoHistory, redoHistory } from "@/features/form-designer/model/history";
import type { PlacedField } from "./designer-types";

vi.mock("@/shared/providers/ThemeProvider", () => ({ useTheme: () => ({ appearance: { surfaceVariant: "default" } }) }));
afterEach(cleanup);
const separator = (props: PlacedField["props"] = {}): PlacedField => ({
  id: "separator", label: "分割线", type: "separator", row: 0, column: 0,
  ...getInitialFieldLayout("separator"), props: { ...getDefaultDesignerFieldProps("separator"), ...props },
});
const group: PlacedField = { id: "group", type: "groupContainer", label: "分组", row: 2, column: 2, rowSpan: 2, colSpan: 2, props: {} };
const subform: PlacedField = { ...group, id: "subform", type: "subform", row: 0, column: 0, colSpan: 6 };

describe("separator designer integration", () => {
  it("appears in the layout toolbox and remains searchable", () => {
    render(<CompTool embedded />);
    const layout = screen.getByRole("heading", { name: "布局" }).closest("section")!;
    expect(within(layout).getByRole("button", { name: "分割线" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索组件" }), { target: { value: "分割线" } });
    expect(within(layout).getAllByRole("button")).toHaveLength(1);
  });

  it("offers style and variant controls without value or validation properties", () => {
    const line = separator();
    render(<FieldPropertyPanel fields={[line]} field={line} onDelete={vi.fn()} onLabelChange={vi.fn()} onPropsChange={vi.fn()} />);
    expect(screen.getByLabelText("分割线风格")).toBeTruthy();
    expect(screen.getByLabelText("分割线变体")).toBeTruthy();
    expect(screen.getByLabelText("分割线方向")).toBeTruthy();
    expect(screen.queryByText("默认值")).toBeNull();
    expect(screen.queryByText("校验")).toBeNull();
    expect(screen.queryByText("禁用")).toBeNull();
    expect(screen.getByText("隐藏")).toBeTruthy();
  });

  it("starts full-width and fits within the active group on insertion or move", () => {
    expect(getInitialFieldLayout("separator")).toEqual({ rowSpan: 1, colSpan: 6 });
    expect(getComponentResizeCapabilities("separator")).toEqual({ columns: true, rows: true });
    expect(placeToolboxField([group], separator(), group.id).fields?.at(-1))
      .toMatchObject({ column: 2, colSpan: 2, parentGroupId: group.id });
    expect(moveField([group, separator()], "separator", 2, 2, group.id).at(-1))
      .toMatchObject({ column: 2, colSpan: 2, parentGroupId: group.id });
  });

  it("rejects subform insertion, moving and pasting", () => {
    expect(placeToolboxField([subform], separator(), subform.id).error).toBeDefined();
    const fields = [subform, separator()];
    expect(moveField(fields, "separator", 0, 0, subform.id)).toBe(fields);
    expect(placePastedFields([subform], [{ ...separator(), parentGroupId: subform.id }])).toBeNull();
    const child: PlacedField = { ...separator(), id: "child", type: "singleLineText", parentGroupId: subform.id, colSpan: 1 };
    expect(planFieldInsertion([subform, child], { ...separator(), fieldId: null }, child.id, "after-column").valid).toBe(false);
  });

  it("preserves props through schema save, reopen, source editing and clipboard", () => {
    const line = separator({ separatorStyle: "dotted", separatorVariant: "tertiary", orientation: "vertical", isHidden: true });
    const saved = buildSchema("form", "表单", [line], getDefaultPageDesignerProps());
    expect(decodeStoredDesignerSchema(saved, "form").fields[0]).toMatchObject(line);
    expect(parseDesignerSource(JSON.stringify(saved), "form").fields[0]).toMatchObject(line);
    const pasted = placePastedFields([line], [{ ...line, id: "copy" }])!;
    expect(pasted.at(-1)).toMatchObject({ id: "copy", type: "separator", props: line.props, row: 1 });
    expect(getAssociationMainTableFields([line])).toEqual([]);
    const invalid = buildSchema("form", "表单", [subform, { ...line, parentGroupId: subform.id }], getDefaultPageDesignerProps());
    expect(() => parseDesignerSource(JSON.stringify(invalid), "form")).toThrow("分割线不能添加到子表单");
  });

  it("participates in add, property update, delete, undo and redo history", () => {
    const line = separator();
    let history = commitHistory(createHistory<PlacedField[]>([]), [line]);
    history = commitHistory(history, [{ ...line, props: { ...line.props, separatorStyle: "dashed" } }]);
    history = commitHistory(history, []);
    const restored = undoHistory(history)!;
    expect(restored.present[0].props.separatorStyle).toBe("dashed");
    expect(redoHistory(restored)!.present).toEqual([]);
    expect(undoHistory(undoHistory(restored)!)!.present).toEqual([]);
  });
});
