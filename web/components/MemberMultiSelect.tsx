"use client";

import { Avatar, Checkbox, Chip, Input, Popover } from "@heroui/react";
import { useMemo, useState } from "react";

export type MemberSelectOption = {
  id: string;
  label: string;
  searchText?: string;
  avatarUrl?: string | null;
  sourceType?: string;
  disabled?: boolean;
};

export function MemberMultiSelect({
  options,
  selectionMode = "multiple",
  value,
  onChange,
  placeholder = "选择成员",
  searchPlaceholder = "搜索成员",
}: {
  selectionMode?: "single" | "multiple";
  options: MemberSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visibleOptions = useMemo(
    () => options.filter((option) =>
      !normalizedQuery || `${option.label} ${option.searchText ?? ""}`
        .toLocaleLowerCase("zh-CN")
        .includes(normalizedQuery),
    ),
    [normalizedQuery, options],
  );
  const selectedLabels = options.filter((option) => value.includes(option.id)).map((option) => option.label);
  const sourceLabel = (sourceType?: string) => sourceType === "dingtalk" ? "钉钉" : sourceType === "local" ? "平台" : sourceType;
  const sourceColor = (sourceType?: string) => sourceType === "dingtalk" ? "accent" : sourceType === "local" ? "success" : "default";
  const selectedOptions = options.filter((option) => value.includes(option.id));

  function toggle(id: string, checked: boolean) {
    if (selectionMode === "single") { onChange(checked ? [id] : []); setIsOpen(false); return; }
    onChange(checked ? [...new Set([...value, id])] : value.filter((item) => item !== id));
  }

  return (
    <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
        <Popover.Trigger aria-label="选择成员" className="input mt-3 flex w-full min-w-0 items-center justify-between text-left text-sm font-normal">
          {selectedOptions.length ? <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"><span className="flex shrink-0 items-center -space-x-2" aria-label={`已选择 ${selectedOptions.length} 位成员`}>{selectedOptions.slice(0, 4).map((option) => <Avatar key={option.id} size="sm" className="ring-2 ring-[var(--color-bg-surface)]"><Avatar.Image src={option.avatarUrl ?? undefined} alt={option.label} /><Avatar.Fallback>{option.label.slice(0, 1)}</Avatar.Fallback></Avatar>)}{selectedOptions.length > 4 ? <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-control-soft)] text-xs text-[var(--color-text-secondary)] ring-2 ring-[var(--color-bg-surface)]">+{selectedOptions.length - 4}</span> : null}</span><span className="min-w-0 truncate">{selectedLabels.join("、")}</span></span> : <span className="min-w-0 truncate">{placeholder}</span>}
        </Popover.Trigger>
      <Popover.Content>
        <Popover.Dialog aria-label="选择成员">
          <Input fullWidth aria-label={searchPlaceholder} placeholder={searchPlaceholder} value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          <div className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto overscroll-contain">
            {visibleOptions.map((option) => (
              <Checkbox key={option.id} isDisabled={option.disabled} isSelected={value.includes(option.id)} onChange={(checked) => toggle(option.id, checked)}>
                <Checkbox.Content className="flex min-w-0 items-center gap-2"><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><Avatar size="sm"><Avatar.Image src={option.avatarUrl ?? undefined} alt="" /><Avatar.Fallback>{option.label.slice(0, 1)}</Avatar.Fallback></Avatar><span className="truncate">{option.label}</span>{sourceLabel(option.sourceType) ? <Chip size="sm" color={sourceColor(option.sourceType)} variant="soft">{sourceLabel(option.sourceType)}</Chip> : null}</Checkbox.Content>
              </Checkbox>
            ))}
            {!visibleOptions.length ? <p className="px-2 py-3 text-xs text-[var(--color-text-secondary)]">未找到成员</p> : null}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
