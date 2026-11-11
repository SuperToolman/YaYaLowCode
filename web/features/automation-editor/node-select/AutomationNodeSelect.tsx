"use client";

import { ListBox, Select } from "@heroui/react";
import { getUpstreamNodes, type AutomationConnection, type SelectableAutomationNode } from "./upstream-nodes";

export function AutomationNodeSelect<T extends SelectableAutomationNode>({
  nodes, edges, currentNodeId, allowedKinds, isSelectable, value, onChange,
  ariaLabel = "数据节点", placeholder = "选择上游数据节点", isDisabled,
}: {
  nodes: readonly T[];
  edges: readonly AutomationConnection[];
  currentNodeId: string;
  allowedKinds: readonly T["data"]["kind"][];
  isSelectable?: (node: T) => boolean;
  value: string;
  onChange: (nodeId: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  isDisabled?: boolean;
}) {
  const options = getUpstreamNodes(nodes, edges, currentNodeId, allowedKinds, isSelectable);
  const selected = options.find((node) => node.id === value);
  return (
    <Select aria-label={ariaLabel} placeholder={placeholder} fullWidth isDisabled={isDisabled}
      selectedKey={selected?.id ?? null}
      onSelectionChange={(key) => {
        if (key != null && options.some((node) => node.id === String(key))) onChange(String(key));
      }}>
      <Select.Trigger><Select.Value>{selected?.data.label || selected?.id}</Select.Value><Select.Indicator /></Select.Trigger>
      <Select.Popover><ListBox aria-label="上游节点">
        {options.map((node) => <ListBox.Item key={node.id} id={node.id} textValue={node.data.label || node.id}>
          <div>{node.data.label || node.id}</div>
          {node.data.description ? <div className="text-xs text-[var(--color-text-secondary)]">{node.data.description}</div> : null}
        </ListBox.Item>)}
      </ListBox></Select.Popover>
    </Select>
  );
}
