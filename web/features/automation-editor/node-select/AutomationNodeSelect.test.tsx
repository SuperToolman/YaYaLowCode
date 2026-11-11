import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AutomationNodeSelect } from "./AutomationNodeSelect";

afterEach(cleanup);

it("根据前置节点回显并选择，连线删除后不再回显失效节点", async () => {
  const nodes = [
    { id: "create", data: { kind: "add-data", label: "新增意向客户" } },
    { id: "current", data: { kind: "add-data", label: "新增联系人子表" } },
    { id: "later", data: { kind: "add-data", label: "后续新增" } },
  ];
  const props = {
    nodes, edges: [{ source: "create", target: "current" }, { source: "current", target: "later" }],
    currentNodeId: "current", allowedKinds: ["add-data"], value: "", onChange: vi.fn(),
  };
  const view = render(<AutomationNodeSelect {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /数据节点/ }));
  const option = await screen.findByRole("option", { name: "新增意向客户" });
  expect(screen.queryByRole("option", { name: "后续新增" })).toBeNull();
  fireEvent.click(option);
  expect(props.onChange).toHaveBeenCalledWith("create");
  view.rerender(<AutomationNodeSelect {...props} value="create" />);
  expect(screen.getByRole("button", { name: /数据节点/ }).textContent).toContain("新增意向客户");
  view.rerender(<AutomationNodeSelect {...props} value="create" edges={[]} />);
  expect(screen.getByRole("button", { name: /数据节点/ }).textContent).not.toContain("新增意向客户");
  const deletedNodes = [...nodes, { id: "delete", data: { kind: "delete-data", label: "删除客户", config: { deleteMode: "data-node", sourceNodeId: "create" } } }];
  view.rerender(<AutomationNodeSelect {...props} value="create" nodes={deletedNodes}
    edges={[{ source: "create", target: "delete" }, { source: "delete", target: "current" }]} />);
  expect(screen.getByRole("button", { name: /数据节点/ }).textContent).not.toContain("新增意向客户");
  fireEvent.click(screen.getByRole("button", { name: /数据节点/ }));
  expect(screen.queryByRole("option", { name: "新增意向客户" })).toBeNull();
});
