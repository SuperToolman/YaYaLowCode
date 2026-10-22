"use client";

import { useId, useState } from "react";
import {
  Button,
  Chip,
  Input,
  Label,
  ListBox,
  Popover,
  Tabs,
} from "@heroui/react";
import { ChevronDown } from "@gravity-ui/icons";
import { getViewFieldTypeLabel } from "@/features/records/model/excel-association";

export type FieldSelectOption = {
  key: string;
  label: string;
  fieldType?: string;
  isSystem?: boolean;
};

function fieldTypeColor(
  type: string,
): "accent" | "success" | "warning" | "danger" | "default" {
  switch (type) {
    case "number":
    case "serialNumber":
      return "warning";
    case "date":
    case "dateRange":
      return "success";
    case "select":
    case "multiSelect":
    case "radio":
    case "checkbox":
    case "cascader":
    case "countryCity":
      return "accent";
    case "member":
    case "department":
      return "danger";
    case "singleLineText":
    case "multiLineText":
    case "richText":
    case "input":
      return "accent";
    default:
      return "default";
  }
}

export type FieldSelectProps = {
  options: readonly FieldSelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  isDisabled?: boolean;
  label?: string;
  isRequired?: boolean;
} & (
  | {
      selectionMode?: "single";
      value: string;
      onChange: (value: string) => void;
    }
  | {
      selectionMode: "multiple";
      value: string[];
      onChange: (value: string[]) => void;
    }
);

/** 字段 key 原样返回；筛选与搜索不改变已有选择。 */
export function FieldSelect(props: FieldSelectProps) {
  const labelId = useId();
  const triggerId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const multiple = props.selectionMode === "multiple";
  const selectedKeys =
    props.selectionMode === "multiple"
      ? props.value
      : props.value
        ? [props.value]
        : [];
  const selected = props.options.filter((option) =>
    selectedKeys.includes(option.key),
  );
  const keyword = query.trim().toLocaleLowerCase();
  const visible = props.options.filter(
    (option) =>
      (tab === "all" ||
        (tab === "system" ? option.isSystem : !option.isSystem)) &&
      (!keyword ||
        `${option.label} ${option.key} ${option.fieldType ? getViewFieldTypeLabel(option.fieldType) : ""}`
          .toLocaleLowerCase()
          .includes(keyword)),
  );
  const placeholder = props.placeholder ?? "选择字段";

  function content(option: FieldSelectOption) {
    return (
      <span className="flex w-full min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {option.isSystem ? <Chip size="sm">系统</Chip> : null}
          {option.fieldType ? (
            <Chip size="sm" color={fieldTypeColor(option.fieldType)}>
              {getViewFieldTypeLabel(option.fieldType)}
            </Chip>
          ) : null}
        </span>
      </span>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {props.label ? (
        <Label
          id={labelId}
          htmlFor={triggerId}
          isRequired={props.isRequired}
          isDisabled={props.isDisabled}
        >
          {props.label}
        </Label>
      ) : null}
      <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
        <Button
          id={triggerId}
          aria-labelledby={props.label ? labelId : undefined}
          aria-label={
            props.label
              ? undefined
              : (props.ariaLabel ?? (placeholder || "选择字段"))
          }
          isDisabled={props.isDisabled}
          className="input flex w-full min-w-0 items-center justify-between text-left font-normal"
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {selected.length
              ? selected.map((option) => option.label).join("、")
              : placeholder}
          </span>
          <ChevronDown className="shrink-0" />
        </Button>
        <Popover.Content className="w-96 max-w-[calc(100vw-2rem)]">
          <Popover.Dialog
            aria-label="字段选择"
            className="flex w-full flex-col gap-2"
          >
            <Input
              aria-label="搜索字段"
              placeholder="搜索字段"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <Tabs
              selectedKey={tab}
              onSelectionChange={(key) => setTab(String(key))}
            >
              <Tabs.List aria-label="字段类型筛选">
                {[
                  ["all", "全部"],
                  ["schema", "Schema字段"],
                  ["system", "系统字段"],
                ].map(([id, label]) => (
                  <Tabs.Tab key={id} id={id}>
                    {label}
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>
            {visible.length ? (
              <ListBox
                aria-label="字段选项"
                className="max-h-64 overflow-y-auto"
                selectionMode={multiple ? "multiple" : "single"}
                selectedKeys={new Set(selectedKeys)}
                onSelectionChange={(keys) => {
                  if (keys === "all") return;
                  const next = Array.from(keys, String);
                  if (props.selectionMode === "multiple") {
                    const visibleKeys = new Set(
                      visible.map((option) => option.key),
                    );
                    props.onChange([
                      ...new Set([
                        ...props.value.filter((key) => !visibleKeys.has(key)),
                        ...next,
                      ]),
                    ]);
                  } else {
                    props.onChange(next[0] ?? "");
                    setIsOpen(false);
                  }
                }}
              >
                {visible.map((option) => (
                  <ListBox.Item
                    key={option.key}
                    id={option.key}
                    textValue={option.label}
                  >
                    {content(option)}
                  </ListBox.Item>
                ))}
              </ListBox>
            ) : (
              <p role="status">没有匹配的字段</p>
            )}
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
