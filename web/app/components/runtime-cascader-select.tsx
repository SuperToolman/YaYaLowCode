"use client";

import { useMemo, useState } from "react";
import { Button, Input, Popover } from "@heroui/react";
import { ChevronDown } from "@gravity-ui/icons";
import {
  getCascaderLabel,
  getCascaderPath,
  getCascaderPathByValue,
  normalizeCascaderDataSource,
  serializeCascaderValue,
  type CascaderOption,
} from "../lib/cascader-data-source";

export function RuntimeCascaderSelect({
  ariaLabel,
  dataSource,
  isDisabled,
  isReadOnly,
  placeholder,
  value,
  onChange,
}: {
  ariaLabel: string;
  dataSource: unknown;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = useMemo(() => normalizeCascaderDataSource(dataSource), [dataSource]);
  const [isOpen, setIsOpen] = useState(false);
  const [path, setPath] = useState<string[]>([]);
  const locale = getRuntimeLocale();
  const selectedPath = getCascaderPathByValue(options, value);
  const columns = [options];
  let branch = options;
  for (const itemValue of path) {
    const item = branch.find((option) => option.value === itemValue);
    if (!item?.children?.length) break;
    branch = item.children;
    columns.push(branch);
  }

  function select(option: CascaderOption, columnIndex: number) {
    if (option.children?.length) {
      setPath((current) => [...current.slice(0, columnIndex), option.value]);
      return;
    }
    onChange(serializeCascaderValue(getCascaderPath(options, option.value)));
    setIsOpen(false);
  }

  const displayValue = selectedPath.length > 0
    ? selectedPath.map((option) => getCascaderLabel(option.label, locale)).join(" / ")
    : "";

  function handleOpenChange(nextIsOpen: boolean) {
    if (!isDisabled && !isReadOnly) {
      setIsOpen(nextIsOpen);
    }
  }

  return <Popover isOpen={isOpen} onOpenChange={handleOpenChange}>
    <Popover.Trigger className="block w-full">
      <div className="relative w-full">
        <Input
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          className="pointer-events-none pr-10"
          disabled={Boolean(isDisabled || isReadOnly)}
          placeholder={placeholder}
          readOnly
          value={displayValue}
          fullWidth
        />
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-[var(--color-text-disabled)]" />
      </div>
    </Popover.Trigger>
    <Popover.Content className="max-h-[min(28rem,calc(100vh-2rem))] max-w-[calc(100vw-2rem)] overflow-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-1 shadow-[var(--shadow-floating)]">
      <Popover.Dialog aria-label={ariaLabel} className="flex min-w-0">
        {columns.map((items, columnIndex) => <div key={columnIndex} className="min-w-36 border-r border-[var(--color-border)] last:border-r-0">
          {items.map((option) => <Button key={option.value} variant="ghost" size="sm" fullWidth className="justify-between" onPress={() => select(option, columnIndex)}>
            <span className="truncate">{getCascaderLabel(option.label, locale)}</span>{option.children?.length ? <span aria-hidden="true">&gt;</span> : null}
          </Button>)}
        </div>)}
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}

function getRuntimeLocale() {
  return typeof navigator === "undefined" ? "zh_CN" : navigator.language.replace("-", "_");
}
