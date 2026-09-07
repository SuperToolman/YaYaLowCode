"use client";

import { useCallback, useMemo, useState } from "react";
import { Button, Checkbox, Input, ListBox, SearchField, Select, Table } from "@heroui/react";
import { ArrowUpArrowDown, Pin, PinSlash, Xmark } from "@gravity-ui/icons";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { ViewConfig } from "../use-form-views";

export type DetailDisplayFieldOption = { id: string; label: string };
export type ViewFieldOption = { id: string; label: string; type: string; typeLabel: string };

function getFieldTypeTagClass(type: string) {
  if (["singleLineText", "multiLineText", "richText", "description", "html", "tsx"].includes(type)) return "field-type-tag--text";
  if (["number", "serialNumber", "formula"].includes(type)) return "field-type-tag--number";
  if (["radio", "checkbox", "select", "multiSelect", "cascader", "countryCity"].includes(type)) return "field-type-tag--choice";
  if (["date", "dateRange"].includes(type)) return "field-type-tag--date";
  if (["member", "department"].includes(type)) return "field-type-tag--person";
  if (["subform", "associationFormField"].includes(type)) return "field-type-tag--relation";
  if (["attachment", "imageUpload"].includes(type)) return "field-type-tag--media";
  return "field-type-tag--builtin";
}

export function ReorderableViewFieldRow({ field, config, onConfigChange }: { field: ViewFieldOption; config: ViewConfig; onConfigChange: (next: ViewConfig) => void }) {
  const id = `view-field-${field.id}`;
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({ id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });
  const setNodeRef = useCallback((node: HTMLDivElement | null) => { setDragRef(node); setDropRef(node); }, [setDragRef, setDropRef]);
  const sortableFieldIds = config.sortableFieldIds ?? config.columnOrder ?? [];
  const frozenFieldIds = config.frozenFieldIds ?? [];
  const configuredWidth = config.columnWidths?.[field.id];
  const isFrozen = frozenFieldIds.includes(field.id);
  const isVisible = config.visibleFieldIds.includes(field.id);
  return <Table.Row ref={setNodeRef} id={field.id} style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined} className={isDragging ? "opacity-60" : isOver ? "bg-accent-soft" : undefined}>
    <Table.Cell><span className="block truncate text-sm">{field.label}</span><span className="mt-0.5 block truncate font-mono text-xs text-muted">{field.id}</span></Table.Cell>
    <Table.Cell><span className={`field-type-tag ${getFieldTypeTagClass(field.type)}`}>{field.typeLabel}</span></Table.Cell>
    <Table.Cell><Checkbox aria-label={`显示列：${field.label}`} isSelected={isVisible} onChange={(selected) => onConfigChange({ ...config, visibleFieldIds: selected ? [...new Set([...config.visibleFieldIds, field.id])] : config.visibleFieldIds.filter((id) => id !== field.id), sortableFieldIds: selected ? sortableFieldIds : sortableFieldIds.filter((id) => id !== field.id), frozenFieldIds: selected ? frozenFieldIds : frozenFieldIds.filter((id) => id !== field.id) })}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox></Table.Cell>
    <Table.Cell><Checkbox aria-label={`显示排序按钮：${field.label}`} isSelected={isVisible && sortableFieldIds.includes(field.id)} isDisabled={!isVisible} onChange={(selected) => onConfigChange({ ...config, sortableFieldIds: selected ? [...new Set([...sortableFieldIds, field.id])] : sortableFieldIds.filter((id) => id !== field.id) })}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox></Table.Cell>
    <Table.Cell><div className="flex items-center gap-1"><Input aria-label={`${field.label}列宽`} type="number" inputMode="numeric" min={80} value={configuredWidth === undefined ? "" : String(configuredWidth)} placeholder="动态" onChange={(event) => { const raw = event.target.value.trim(); const columnWidths = { ...(config.columnWidths ?? {}) }; if (!raw) delete columnWidths[field.id]; else { const width = Number(raw); if (!Number.isFinite(width)) return; columnWidths[field.id] = Math.max(80, Math.round(width)); } onConfigChange({ ...config, columnWidths }); }} className="w-20" /><Button isIconOnly variant="ghost" aria-label={`清空${field.label}列宽`} isDisabled={configuredWidth === undefined} onPress={() => { const columnWidths = { ...(config.columnWidths ?? {}) }; delete columnWidths[field.id]; onConfigChange({ ...config, columnWidths }); }}><Xmark /></Button></div></Table.Cell>
    <Table.Cell><div className="flex items-center gap-1"><Button isIconOnly variant="ghost" aria-label={`${isFrozen ? "取消冻结" : "冻结"}${field.label}列`} isDisabled={!isVisible} onPress={() => onConfigChange({ ...config, frozenFieldIds: isFrozen ? frozenFieldIds.filter((id) => id !== field.id) : [...frozenFieldIds, field.id] })}>{isFrozen ? <PinSlash /> : <Pin />}</Button><Button isIconOnly variant="ghost" aria-label={`拖拽调整${field.label}列顺序`} {...attributes} {...listeners}><ArrowUpArrowDown /></Button></div></Table.Cell>
  </Table.Row>;
}

export function DetailDisplayFieldSelect({ ariaLabel, options, selectedKey, onSelectionChange }: { ariaLabel: string; options: DetailDisplayFieldOption[]; selectedKey: string; onSelectionChange: (key: string) => void }) {
  const [query, setQuery] = useState("");
  const filteredOptions = useMemo(() => { const normalizedQuery = query.trim().toLocaleLowerCase(); return normalizedQuery ? options.filter((option) => option.label.toLocaleLowerCase().includes(normalizedQuery)) : options; }, [options, query]);
  return <Select aria-label={ariaLabel} selectedKey={selectedKey} onSelectionChange={(key) => onSelectionChange(String(key ?? selectedKey))}><Select.Trigger><Select.Value>{options.find((field) => field.id === selectedKey)?.label ?? selectedKey}</Select.Value></Select.Trigger><Select.Popover className="w-64"><div className="border-b border-[var(--color-border)] p-2"><SearchField aria-label={`搜索${ariaLabel}`} value={query} onChange={setQuery}><SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="搜索字段" /><SearchField.ClearButton aria-label="清除搜索" /></SearchField.Group></SearchField></div><ListBox className="max-h-56 overflow-y-auto" aria-label={ariaLabel}>{filteredOptions.map((field) => <ListBox.Item key={field.id} id={field.id}>{field.label}</ListBox.Item>)}{filteredOptions.length === 0 ? <ListBox.Item id="empty" isDisabled>没有匹配字段</ListBox.Item> : null}</ListBox></Select.Popover></Select>;
}

export function ViewTab({ isActive, label, onClick }: { isActive: boolean; label: string; onClick: () => void }) { return <Button onPress={onClick} className={["h-9 rounded-lg px-3 !text-[12px]", isActive ? "bg-[var(--color-primary-soft)] font-medium text-[var(--color-primary)]" : "border border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-panel-soft)]"].join(" ")}><span className="!text-[12px]">{label}</span></Button>; }
export function IconToolbarButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) { return <Button isIconOnly variant="secondary" aria-label={label} onPress={onPress} className="h-9 w-9 p-0">{children}</Button>; }
