import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BranchRulesEditor } from "./BranchRulesEditor";

vi.mock("../../form-controls/components/FieldSelect", () => ({
  FieldSelect: ({ options, ariaLabel }: { options: { key: string }[]; ariaLabel: string }) => (
    <div data-testid={ariaLabel}>{options.map(option => option.key).join(",")}</div>
  ),
}));

afterEach(cleanup);
const targets = [{ key: "target", label: "目标", fieldType: "singleLineText", options: [] }];
const sources = [{ key: "source", label: "来源", fieldType: "singleLineText", options: [] }];
const callbacks = { onAddConditionRule: vi.fn(), onRemoveConditionRule: vi.fn(), onConditionRuleChange: vi.fn() };
it("嵌套关联条件左侧使用目标字段，右侧使用当前记录字段", () => {
  render(<BranchRulesEditor {...callbacks} sourceFieldChoices={targets} comparisonFieldChoices={sources} targetFieldLabel="目标表单字段" rules={[
    { id: "group", isGroup: true },
    { id: "rule", parentId: "group", fieldKey: "target", valueType: "field", sourceFieldKey: "source" },
  ]} />);
  expect(screen.getByTestId("目标表单字段").textContent).toBe("target");
  expect(screen.getByTestId("来源字段").textContent).toBe("source");
});

it("未传比较字段时保留原有规则编辑器行为", () => {
  render(<BranchRulesEditor {...callbacks} sourceFieldChoices={targets} rules={[
    { id: "rule", fieldKey: "target", valueType: "field", sourceFieldKey: "target" },
  ]} />);
  expect(screen.getAllByTestId("来源字段").map(element => element.textContent)).toEqual(["target", "target"]);
});
