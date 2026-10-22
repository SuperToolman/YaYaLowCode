"use client";

import { Autocomplete, Label, ListBox, SearchField, Tag, TagGroup } from "@heroui/react";
import { useFilter } from "react-aria";
import { useMemo } from "react";
import { DisplayTag } from "@shared/DisplayTag";

export type RoleSelectOption = {
  id: string;
  label: string;
  searchText?: string;
  sourceType?: string;
  disabled?: boolean;
};

export function RoleMultiSelect({
  options,
  value,
  onChange,
  label,
  placeholder = "选择角色",
  searchPlaceholder = "搜索角色",
}: {
  options: RoleSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
  placeholder?: string;
  searchPlaceholder?: string;
}) {
  const { contains } = useFilter({ sensitivity: "base" });
  const sortedOptions = useMemo(() => [...options].sort((a, b) => {
    const sourceOrder = (source?: string) => source === "local" ? 0 : source === "dingtalk" ? 1 : 2;
    return sourceOrder(a.sourceType) - sourceOrder(b.sourceType)
      || a.label.localeCompare(b.label, "zh-CN", { numeric: true })
      || a.id.localeCompare(b.id);
  }), [options]);
  const sourceLabel = (source?: string) => source === "dingtalk" ? "钉钉" : source === "local" ? "平台" : source;

  return (
    <Autocomplete
      aria-label="选择角色"
      selectionMode="multiple"
      disabledKeys={options.filter((option) => option.disabled).map((option) => option.id)}
      value={value}
      onChange={(keys) => onChange(keys.map(String))}
      placeholder={placeholder}
      fullWidth
      onClear={() => onChange([])}
    >
      {label ? <Label className="text-sm">{label}</Label> : null}
      <Autocomplete.Trigger>
        <Autocomplete.Value>
          {({ isPlaceholder }) => isPlaceholder ? placeholder : (
            <TagGroup
              aria-label="已选角色"
              onRemove={(keys) => onChange(value.filter((id) => !keys.has(id)))}
              onClick={(event) => event.stopPropagation()}
            >
              <TagGroup.List>
                {value.map((id) => {
                  const option = options.find((item) => item.id === id);
                  return (
                    <Tag key={id} id={id} textValue={option?.label ?? id}>
                      {option?.label ?? id}
                      <Tag.RemoveButton aria-label={`移除角色 ${option?.label ?? id}`} />
                    </Tag>
                  );
                })}
              </TagGroup.List>
            </TagGroup>
          )}
        </Autocomplete.Value>
        <Autocomplete.ClearButton aria-label="清除已选角色" />
        <Autocomplete.Indicator />
      </Autocomplete.Trigger>
      <Autocomplete.Popover>
        <Autocomplete.Filter filter={contains}>
          <SearchField aria-label={searchPlaceholder} autoFocus>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={searchPlaceholder} />
              <SearchField.ClearButton aria-label="清除角色搜索" />
            </SearchField.Group>
          </SearchField>
          <ListBox
            aria-label="角色选项"
            items={sortedOptions}
            renderEmptyState={() => <span>未找到角色</span>}
          >
            {(option) => (
              <ListBox.Item id={option.id} textValue={option.label}>
                <ListBox.ItemIndicator />
                <Label>{option.label}</Label>
                {sourceLabel(option.sourceType) ? (
                  <DisplayTag color={option.sourceType === "dingtalk" ? "accent" : option.sourceType === "local" ? "success" : "default"}>
                    {sourceLabel(option.sourceType)}
                  </DisplayTag>
                ) : null}
              </ListBox.Item>
            )}
          </ListBox>
        </Autocomplete.Filter>
      </Autocomplete.Popover>
    </Autocomplete>
  );
}
