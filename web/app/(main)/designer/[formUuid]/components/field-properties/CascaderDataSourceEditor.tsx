"use client";

import { useState } from "react";
import { Button, InputGroup, Popover } from "@heroui/react";
import {
  DEFAULT_CASCADER_DATA_SOURCE,
  normalizeCascaderDataSource,
  parseCascaderDataSource,
} from "../../../../../lib/cascader-data-source";
import type { FieldPropsChangeHandler, PlacedField } from "../../designer-types";

export function CascaderDataSourceEditor({ field, onPropsChange }: { field: PlacedField; onPropsChange: FieldPropsChangeHandler }) {
  const serializedValue = JSON.stringify(
    normalizeCascaderDataSource(field.props.dataSource ?? DEFAULT_CASCADER_DATA_SOURCE),
    null,
    2,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(serializedValue);
  const [error, setError] = useState("");

  function handleOpenChange(nextIsOpen: boolean) {
    if (nextIsOpen) {
      setDraftValue(serializedValue);
      setError("");
    }
    setIsOpen(nextIsOpen);
  }

  function save() {
    const dataSource = parseCascaderDataSource(draftValue);
    if (!dataSource) {
      setError("请输入有效的数组 JSON；每项必须包含非空 value 与 label。");
      return;
    }
    onPropsChange(field.id, { dataSource });
    setError("");
    setIsOpen(false);
  }

  return <Popover isOpen={isOpen} onOpenChange={handleOpenChange}>
    <Popover.Trigger><Button size="sm" variant="secondary">编辑数据源</Button></Popover.Trigger>
    <Popover.Content className="w-[min(32rem,calc(100vw-2rem))] border border-[var(--designer-border)] bg-[var(--designer-surface-solid)] p-0">
      <Popover.Dialog className="space-y-2 p-3">
        <Popover.Heading className="text-sm font-medium">数据源 JSON</Popover.Heading>
        <InputGroup fullWidth><InputGroup.TextArea aria-label="级联选择数据源 JSON" rows={16} value={draftValue} onChange={(event) => { setDraftValue(event.currentTarget.value); setError(""); }} className="font-mono text-xs" /></InputGroup>
        {error ? <p className="text-xs text-[var(--color-danger)]">{error}</p> : null}
        <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onPress={() => setIsOpen(false)}>取消</Button><Button size="sm" onPress={save}>保存</Button></div>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}
