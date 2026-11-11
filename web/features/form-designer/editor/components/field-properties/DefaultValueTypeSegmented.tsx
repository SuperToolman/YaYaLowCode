"use client";

import type { DesignerDefaultValueType } from "../CompTool";
import { PropertyToggle, PropertyToggleGroup } from "../property-panel/PropertyControls";

export const DEFAULT_VALUE_TYPE_OPTIONS: Array<{
  label: string;
  value: DesignerDefaultValueType;
}> = [
  { label: "无", value: "none" },
  { label: "自定义", value: "custom" },
  { label: "公式", value: "formula" },
  { label: "联动", value: "linkage" },
  { label: "筛选", value: "filter" },
  { label: "当前登录人", value: "currentUser" },
];

export function DefaultValueTypeSegmented({
  onChange,
  options,
  value,
  disabledOptions = [],
}: {
  onChange: (value: DesignerDefaultValueType) => void;
  options: DesignerDefaultValueType[];
  value: DesignerDefaultValueType;
  disabledOptions?: DesignerDefaultValueType[];
}) {
  return (
    <PropertyToggleGroup
      aria-label="默认值类型"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const selected = options.find((option) => keys.has(option));
        if (selected && !disabledOptions.includes(selected)) onChange(selected);
      }}
    >
      {DEFAULT_VALUE_TYPE_OPTIONS.filter((option) =>
        options.includes(option.value),
      ).map((option) => (
        <PropertyToggle
          key={option.value}
          id={option.value}
          isDisabled={disabledOptions.includes(option.value)}
        >
          {option.label}
        </PropertyToggle>
      ))}
    </PropertyToggleGroup>
  );
}
