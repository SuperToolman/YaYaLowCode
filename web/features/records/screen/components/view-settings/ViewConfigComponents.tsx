/**
 * 表单字段选择组件
 */

"use client";

import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button, ButtonGroup, Checkbox, Description, InputGroup, ListBox, SearchField, Select, Table, Chip } from "@heroui/react";
import { ArrowChevronRight, ArrowUpArrowDown, Pin, PinSlash, Xmark } from "@gravity-ui/icons";
import { DndContext, useDraggable, useDroppable, type DragEndEvent, type SensorDescriptor, type SensorOptions } from "@dnd-kit/core";
import type { ViewConfig } from "@/features/records/screen/model/use-form-views";

export type DetailDisplayFieldOption = { id: string; label: string };
export type ViewFieldOption = {
  id: string;
  label: string;
  type: string;
  typeLabel: string;
  linkedFieldIds?: string[];
  parentSubformId?: string;
  isSubformGroup?: boolean;
  children?: ViewFieldOption[];
};

function getFieldTypeChipStyle(type: string): CSSProperties {
  const tokenType = type === "formula" ? "number" : type;
  const safeTokenType = /^[A-Za-z][A-Za-z0-9]*$/.test(tokenType)
    ? tokenType
    : "default";
  return {
    "--chip-bg": `var(--field-type-${safeTokenType}-background, var(--default))`,
    "--chip-fg": `var(--field-type-${safeTokenType}-foreground, var(--default-foreground))`,
  } as CSSProperties;
}

export function ViewFieldsDragContext({
  sensors,
  onDragEnd,
  children,
}: {
  sensors: SensorDescriptor<SensorOptions>[];
  onDragEnd: (event: DragEndEvent) => void;
  children: ReactNode;
}) {
  return <DndContext sensors={sensors} onDragEnd={onDragEnd}>{children}</DndContext>;
}

export function ReorderableViewFieldRow({
  field,
  config,
  onConfigChange,
  isDragDisabled = false,
}: {
  field: ViewFieldOption;
  config: ViewConfig;
  onConfigChange: (next: ViewConfig) => void;
  isDragDisabled?: boolean;
}) {
  const id = `view-field-${field.id}`;
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({
    id,
    disabled: isDragDisabled,
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id,
    disabled: isDragDisabled,
  });
  const setNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );
  const sortableFieldIds = config.sortableFieldIds ?? config.columnOrder ?? [];
  const frozenFieldIds = config.frozenFieldIds ?? [];
  const linkedFieldIds = field.linkedFieldIds ?? [field.id];
  const fieldIdLabel = linkedFieldIds.join("、");
  const configuredWidth = config.columnWidths?.[field.id];
  const widthInputRef = useRef<HTMLInputElement>(null);
  const isFrozen = linkedFieldIds.every((id) => frozenFieldIds.includes(id));
  const isVisible =
    linkedFieldIds.length > 0 &&
    linkedFieldIds.every((id) => config.visibleFieldIds.includes(id));
  const isSubformGroup = field.isSubformGroup === true;
  return (
    <Table.Row
      ref={setNodeRef}
      id={field.id}
      textValue={field.label}
      style={
        transform || isDragging
          ? {
              ...(transform
                ? {
                    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
                  }
                : {}),
              ...(isDragging ? { opacity: 0.6 } : {}),
            }
          : undefined
      }
    >
      <Table.Cell>
        <div className="flex min-w-0 items-center gap-1">
            {field.children?.length ? (
              <Button
                slot="chevron"
                isIconOnly
                size="sm"
                variant="tertiary"
                aria-label={`展开或收起${field.label}`}
              >
                <ArrowChevronRight aria-hidden="true" className="size-3.5" />
              </Button>
            ) : null}
            <span className="block min-w-0 truncate">{field.label}</span>
        </div>
        {isSubformGroup ? null : (
          <Description title={fieldIdLabel}>{fieldIdLabel}</Description>
        )}
      </Table.Cell>
      <Table.Cell>
        <Chip
          size="sm"
          color="default"
          style={getFieldTypeChipStyle(field.type)}
        >
          {field.typeLabel}
        </Chip>
      </Table.Cell>
      <Table.Cell>
        <Checkbox
          aria-label={`显示列：${field.label}`}
          isSelected={isVisible}
          onChange={(selected) =>
            onConfigChange({
              ...config,
              visibleFieldIds: selected
                ? [...new Set([...config.visibleFieldIds, ...linkedFieldIds])]
                : config.visibleFieldIds.filter(
                    (id) => !linkedFieldIds.includes(id),
                  ),
              sortableFieldIds: selected
                ? sortableFieldIds
                : sortableFieldIds.filter((id) => !linkedFieldIds.includes(id)),
              frozenFieldIds: selected
                ? frozenFieldIds
                : frozenFieldIds.filter((id) => !linkedFieldIds.includes(id)),
            })
          }
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox.Content>
        </Checkbox>
      </Table.Cell>
      <Table.Cell>
        <Checkbox
          aria-label={`显示排序按钮：${field.label}`}
          isSelected={!isSubformGroup && isVisible && sortableFieldIds.includes(field.id)}
          isDisabled={isSubformGroup || !isVisible}
          onChange={(selected) =>
            onConfigChange({
              ...config,
              sortableFieldIds: selected
                ? [...new Set([...sortableFieldIds, field.id])]
                : sortableFieldIds.filter((id) => id !== field.id),
            })
          }
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox.Content>
        </Checkbox>
      </Table.Cell>
      <Table.Cell>
        <InputGroup style={{ width: 120 }}>
          <InputGroup.Input
            ref={widthInputRef}
            aria-label={`${field.label}列宽`}
            type="number"
            inputMode="numeric"
            min={80}
            disabled={isSubformGroup}
            defaultValue={configuredWidth === undefined ? "" : String(configuredWidth)}
            placeholder="动态"
            style={{ width: 0, minWidth: 0 }}
            onBlur={(event) => {
              const raw = event.target.value.trim();
              const columnWidths = { ...(config.columnWidths ?? {}) };
              if (!raw) {
                if (configuredWidth === undefined) return;
                delete columnWidths[field.id];
              } else {
                const width = Number(raw);
                if (!Number.isFinite(width)) return;
                const nextWidth = Math.max(80, Math.round(width));
                if (nextWidth === configuredWidth) return;
                columnWidths[field.id] = nextWidth;
              }
              onConfigChange({ ...config, columnWidths });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <InputGroup.Suffix>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label={`清空${field.label}列宽`}
              isDisabled={isSubformGroup}
              onPress={() => {
                if (widthInputRef.current) widthInputRef.current.value = "";
                if (configuredWidth === undefined) return;
                const columnWidths = { ...(config.columnWidths ?? {}) };
                delete columnWidths[field.id];
                onConfigChange({ ...config, columnWidths });
              }}
            >
              <Xmark />
            </Button>
          </InputGroup.Suffix>
        </InputGroup>
      </Table.Cell>
      <Table.Cell>
        <ButtonGroup size="sm" variant="tertiary" aria-label={`${field.label}操作`}>
          <Button
            isIconOnly
            aria-label={`${isFrozen ? "取消冻结" : "冻结"}${field.label}列`}
            isDisabled={isSubformGroup || !isVisible}
            onPress={() => {
              onConfigChange({
                ...config,
                frozenFieldIds: isFrozen
                  ? frozenFieldIds.filter((id) => !linkedFieldIds.includes(id))
                  : [...new Set([...frozenFieldIds, ...linkedFieldIds])],
              });
            }}
          >
            {isFrozen ? <PinSlash /> : <Pin />}
          </Button>
          <Button
            isIconOnly
            aria-label={`拖拽调整${field.label}列顺序`}
            isDisabled={isDragDisabled}
            {...attributes}
            {...listeners}
            style={{ touchAction: "none" }}
          >
            <ArrowUpArrowDown />
          </Button>
        </ButtonGroup>
      </Table.Cell>
      {field.children?.length ? (
        <Table.Collection items={field.children}>
          {(child) => (
            <ReorderableViewFieldRow
              key={child.id}
              field={child}
              config={config}
              onConfigChange={onConfigChange}
              isDragDisabled={isDragDisabled}
            />
          )}
        </Table.Collection>
      ) : null}
    </Table.Row>
  );
}

export function DetailDisplayFieldSelect({
  ariaLabel,
  options,
  selectedKey,
  onSelectionChange,
}: {
  ariaLabel: string;
  options: DetailDisplayFieldOption[];
  selectedKey: string;
  onSelectionChange: (key: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery
      ? options.filter((option) =>
          option.label.toLocaleLowerCase().includes(normalizedQuery),
        )
      : options;
  }, [options, query]);
  return (
    <Select
      aria-label={ariaLabel}
      selectedKey={selectedKey}
      onSelectionChange={(key) => onSelectionChange(String(key ?? selectedKey))}
    >
      <Select.Trigger>
        <Select.Value>
          {options.find((field) => field.id === selectedKey)?.label ??
            selectedKey}
        </Select.Value>
      </Select.Trigger>
      <Select.Popover style={{ width: 256 }}>
        <div
          style={{
            borderBottom: "1px solid var(--color-border)",
            padding: 8,
          }}
        >
          <SearchField
            aria-label={`搜索${ariaLabel}`}
            value={query}
            onChange={setQuery}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="搜索字段" />
              <SearchField.ClearButton aria-label="清除搜索" />
            </SearchField.Group>
          </SearchField>
        </div>
        <ListBox
          style={{ maxHeight: 224, overflowY: "auto" }}
          aria-label={ariaLabel}
        >
          {filteredOptions.map((field) => (
            <ListBox.Item key={field.id} id={field.id}>
              {field.label}
            </ListBox.Item>
          ))}
          {filteredOptions.length === 0 ? (
            <ListBox.Item id="empty" isDisabled>
              没有匹配字段
            </ListBox.Item>
          ) : null}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function ViewTab({
  isActive,
  label,
  onClick,
}: {
  isActive: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={isActive ? "primary" : "ghost"}
      onPress={onClick}
    >
      {label}
    </Button>
  );
}
export function IconToolbarButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      isIconOnly
      variant="secondary"
      aria-label={label}
      onPress={onPress}
      size="sm"
    >
      {children}
    </Button>
  );
}
