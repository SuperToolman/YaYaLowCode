import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssociationDefaultsContext, RuntimeAssociationField } from "./RuntimeAssociationField";
import { fetchAssociationRecords } from "../api";
import type { RuntimeSchemaField } from "../../form-model/runtime-types";

vi.mock("../api", () => ({ fetchAssociationRecords: vi.fn() }));
vi.mock("@heroui/react", () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Select = Object.assign(({ selectedKey, onSelectionChange, children }: { selectedKey: string; onSelectionChange: (key: string) => void; children: React.ReactNode }) => <div><output data-testid="selected">{selectedKey}</output><button onClick={() => onSelectionChange("")}>清空</button>{children}</div>, { Trigger: Box, Value: Box, Popover: Box, Indicator: () => null });
  return { Select, ListBox: Object.assign(Box, { Item: Box }), Label: Box, FieldError: Box };
});

afterEach(cleanup);
beforeEach(() => vi.mocked(fetchAssociationRecords).mockResolvedValue([
  { id: "no", createdAt: "2026-10-22T12:00:00Z", data: { status: "closed" } },
  { id: "match", createdAt: "2026-10-21T12:00:00Z", data: { status: "open", name: "默认记录" } },
]));

let formSequence = 0;
function Harness({ enabled = true, initial = "" }: { enabled?: boolean; initial?: string }) {
  const [value, setValue] = useState(initial);
  const [field] = useState<RuntimeSchemaField>(() => ({ id: "association", label: "关联", type: "associationFormField", row: 0, column: 0, props: { associationFormId: `form-${++formSequence}`, associationPrimaryFieldId: "name", defaultValueType: "filter", associationDefaultRules: [{ id: "r", fieldKey: "status", operator: "eq", rawValue: "open" }] } }));
  return <AssociationDefaultsContext.Provider value={enabled}><RuntimeAssociationField field={field} value={value} onChange={setValue} onFill={onFill} /></AssociationDefaultsContext.Provider>;
}
const onFill = vi.fn();

describe("关联默认值", () => {
  it("重新打开同一表单时读取最新记录，不沿用上次的缓存", async () => {
    const field: RuntimeSchemaField = {
      id: "fresh-association", label: "关联", type: "associationFormField", row: 0, column: 0,
      props: { associationFormId: "fresh-form", defaultValueType: "filter", associationDefaultRules: [{ id: "r", fieldKey: "status", operator: "eq", rawValue: "open" }] },
    };
    const onChange = vi.fn();
    const view = render(<AssociationDefaultsContext.Provider value><RuntimeAssociationField field={field} value="" onChange={onChange} onFill={onFill} /></AssociationDefaultsContext.Provider>);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("match"));
    view.unmount();
    vi.mocked(fetchAssociationRecords).mockResolvedValue([{ id: "fresh", createdAt: "2026-10-23T00:00:00Z", data: { status: "open" } }]);
    onChange.mockClear();
    render(<AssociationDefaultsContext.Provider value><RuntimeAssociationField field={field} value="" onChange={onChange} onFill={onFill} /></AssociationDefaultsContext.Provider>);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("fresh"));
  });
  it("多条匹配时按创建时间取最新记录，不依赖列表顺序", async () => {
    vi.mocked(fetchAssociationRecords).mockResolvedValue([
      { id: "old", createdAt: "2026-10-20T12:00:00Z", data: { status: "open" } },
      { id: "newest", createdAt: "2026-10-22T12:00:00Z", data: { status: "open" } },
      { id: "middle", createdAt: "2026-10-21T12:00:00Z", data: { status: "open" } },
      { id: "excluded", createdAt: "2026-10-23T12:00:00Z", data: { status: "closed" } },
    ]);
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("newest"));
  });
  it("按筛选选择记录并执行填充，用户清空后不自动恢复", async () => {
    onFill.mockClear();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("match"));
    expect(onFill).toHaveBeenCalledWith({ status: "open", name: "默认记录" });
    fireEvent.click(screen.getByText("清空"));
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe(""));
  });
  it("编辑已有表单的空值不应用默认值", async () => {
    render(<Harness enabled={false} />);
    await screen.findByText("默认记录");
    expect(screen.getByTestId("selected").textContent).toBe("");
  });
  it("保留已有记录值", async () => {
    render(<Harness initial="no" />);
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("no"));
  });
});
