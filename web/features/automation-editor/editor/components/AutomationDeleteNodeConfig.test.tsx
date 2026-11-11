import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DataNodeConfigFields } from "./AutomationDataNodeConfig";
import { defaultNodeTemplate, normalizeFormSchema } from "../../model/automation-editor-model";
import type { WorkflowNode } from "@/features/automation-editor/model/editor-types";

vi.mock("@/features/form-controls/components/FormSelect", () => ({ FormSelect: () => <div>目标表单选择器</div> }));
vi.mock("./AutomationConditionRuleEditor", () => ({ BranchRulesEditor: () => <div>公共条件组件</div> }));
vi.mock("@/shared/providers/ThemeProvider", () => ({ useTheme: () => ({ appearance: { surfaceVariant: "default" } }) }));
afterEach(cleanup);

it("删除支持公共条件组件和上游节点选择，不再显示表达式编辑器", async () => {
  const source: WorkflowNode = { id: "create", type: "workflow", position: { x: 0, y: 0 }, data: { ...defaultNodeTemplate("add-data"), label: "新增客户", config: { targetFormUuid: "customers" } } };
  const node: WorkflowNode = { id: "delete", type: "workflow", position: { x: 0, y: 0 }, data: { ...defaultNodeTemplate("delete-data"), config: { deleteMode: "form", targetFormUuid: "customers", filterMode: "rules", rules: [] } } };
  const props = {
    appId: "app", forms: [], nodes: [source,node], edges: [{ id: "e", source: "create", target: "delete" }], node,
    selectedSchema: normalizeFormSchema({ formUuid: "customers", fields: [{ id: "name", type: "singleLineText" }] }),
    sourceFieldChoices: [], getManySourceOptions: [], multipleSourceFieldChoices: [], updateSourceOptions: [], updateTargetFormOptions: [],
    onUpdateConfigChange: vi.fn(), onUpdateSourceNodeChange: vi.fn(),
  } as unknown as Parameters<typeof DataNodeConfigFields>[0];
  const view = render(<DataNodeConfigFields {...props} />);
  expect(screen.getByText("公共条件组件")).toBeTruthy();
  expect(screen.queryByLabelText("匹配条件")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /删除方式/ }));
  fireEvent.click(await screen.findByRole("option", { name: "按节点删除数据" }));
  expect(props.onUpdateConfigChange).toHaveBeenCalledWith("deleteMode", "data-node");
  view.rerender(<DataNodeConfigFields {...props} node={{ ...node, data: { ...node.data, config: { deleteMode: "data-node", sourceNodeId: "", targetFormUuid: "customers" } } }} />);
  expect(screen.queryByText("公共条件组件")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /删除数据源/ }));
  fireEvent.click(await screen.findByRole("option", { name: /新增客户/ }));
  expect(props.onUpdateSourceNodeChange).toHaveBeenCalledWith("create");
});
