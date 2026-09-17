"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, Key } from "react";
import Image from "next/image";
import {
  Button,
  DateRangePicker,
  Input,
  ListBox,
  Popover,
  RangeCalendar,
  Select,
  toast,
} from "@heroui/react";
import styles from "./RuntimeFormControls.module.css";
import { DateInputGroup } from "@heroui/react/date-input-group";
import { ChevronDown } from "@gravity-ui/icons";
import { parseDate } from "@internationalized/date";
import { uploadFile } from "@features/files/api";
import {
  getLocationLabel,
  listLocationChildren,
  normalizeCountryCityValue,
  toStoredLocationItem,
  type CountryCityValue,
  type LocationCatalogItem,
} from "@lib/location-catalog";
import type { RuntimeFieldOption, RuntimeFieldProps, RuntimeSchemaField } from "./runtime-form-types";


function getOptionLabel(options: RuntimeFieldOption[], value: string) {
  return options.find((option) => option.value === value)?.label ?? "";
}

function getDateRangeValue(value: string[]) {
  const [startValue, endValue] = value;
  if (!startValue || !endValue) return undefined;
  try {
    return { start: parseDate(startValue), end: parseDate(endValue) };
  } catch {
    return undefined;
  }
}

export function RuntimeSelect({
  field,
  onChange,
  options,
  placeholder,
  props,
  value,
}: {
  field: RuntimeSchemaField;
  onChange: (value: string) => void;
  options: RuntimeFieldOption[];
  placeholder: string;
  props: RuntimeFieldProps;
  value: string;
}) {
  return (
    <Select
      aria-label={field.label}
      className={styles["form-runtime-controls__select-field"]}
      selectedKey={value || null}
      onSelectionChange={(key: Key | null) => onChange(key === null ? "" : String(key))}
      isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
      isRequired={props.isRequired}
      fullWidth
    >
      <Select.Trigger>
        <Select.Value>{getOptionLabel(options, value) || placeholder}</Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function RuntimeCountryCitySelect({
  field,
  props,
  value,
  onChange,
}: {
  field: RuntimeSchemaField;
  props: RuntimeFieldProps;
  value: unknown;
  onChange: (value: CountryCityValue, eventName: "onChange") => void;
}) {
  const maxDepth = Math.min(4, Math.max(1, Math.round(props.locationDepth ?? 3)));
  const popoverWidth = `${maxDepth === 1 ? 18 : maxDepth * 14}rem`;
  const [isOpen, setIsOpen] = useState(false);
  const [columns, setColumns] = useState<LocationCatalogItem[][]>([]);
  const [activePath, setActivePath] = useState<LocationCatalogItem[]>([]);
  const [selectionIsLeaf, setSelectionIsLeaf] = useState(false);
  const [searches, setSearches] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const location = normalizeCountryCityValue(value);
  const isDisabled = Boolean(props.isDisabled || props.isReadOnly);
  const selectedPath = location.path;
  const filteredColumns = useMemo(() => columns
    .map((items, columnIndex) => ({
      columnIndex,
      items: searches[columnIndex]?.trim()
        ? items.filter((item) => matchesLocationSearch(item, searches[columnIndex]))
        : items,
    })), [columns, searches]);

  useEffect(() => {
    let active = true;
    listLocationChildren(undefined, 1)
      .then((items) => active && setColumns([items]))
      .catch(() => {
        if (!active) return;
        setColumns([[]]);
        setLoadError("地区目录加载失败");
      })
      .finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, []);

  async function selectItem(item: LocationCatalogItem, columnIndex: number) {
    const nextPath = [...activePath.slice(0, columnIndex), item];
    setActivePath(nextPath);
    setSelectionIsLeaf(false);
    setSearches((current) => {
      const next = current.slice(0, columnIndex + 1);
      next[columnIndex] = "";
      return next;
    });
    if (item.depth >= maxDepth) {
      setSelectionIsLeaf(true);
      setColumns((current) => current.slice(0, columnIndex + 1));
      return;
    }
    setIsLoading(true);
    setLoadError("");
    try {
      const children = await listLocationChildren(item.code, item.depth + 1);
      setSelectionIsLeaf(children.length === 0);
      setColumns((current) => children.length > 0
        ? [...current.slice(0, columnIndex + 1), children]
        : current.slice(0, columnIndex + 1));
    } catch {
      setSelectionIsLeaf(true);
      setColumns((current) => current.slice(0, columnIndex + 1));
      setLoadError("地区目录加载失败");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Popover isOpen={isOpen} onOpenChange={(next) => !isDisabled && setIsOpen(next)}>
      <Popover.Trigger aria-label={field.label} className="block w-full">
        <div
          style={{ backgroundColor: "var(--field-background)" }}
          className={[
            "flex h-10 w-full min-w-0 items-center gap-2 rounded-xl bg-[var(--field-background)] px-3 text-sm text-[var(--color-text-primary)] shadow-[var(--shadow-card-glass)]",
            isDisabled ? "cursor-not-allowed opacity-60" : "",
          ].join(" ")}
        >
          <span className={[
            "min-w-0 flex-1 truncate leading-5",
            selectedPath.length === 0 ? "text-[var(--color-text-disabled)]" : "",
          ].join(" ")}>
            {selectedPath.length > 0
              ? selectedPath.map((item) => getLocationLabel(item)).join(" / ")
              : (props.placeholder || "请选择国家/地区")}
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--color-text-disabled)]" />
        </div>
      </Popover.Trigger>
      <Popover.Content className="max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-[var(--color-bg-surface)] p-0 shadow-[var(--shadow-floating)]" style={{ width: `min(${popoverWidth}, calc(100vw - 2rem))` }}>
        <Popover.Dialog aria-label={`${field.label}国家地区选择`} className="w-full min-w-0">
          <div className="flex min-w-0 overflow-x-auto" role="listbox">
            {filteredColumns.map(({ items, columnIndex }) => <div key={columnIndex} className={["flex h-72 shrink-0 flex-col border-r border-[var(--color-border)] last:border-r-0", maxDepth === 1 ? "w-full" : "w-56"].join(" ")}>
              <div className="border-b border-[var(--color-border)] p-2"><Input aria-label={`搜索第${columnIndex + 1}级地区`} placeholder={`搜索第${columnIndex + 1}级地区`} value={searches[columnIndex] ?? ""} onChange={(event) => setSearches((current) => { const next = [...current]; next[columnIndex] = event.currentTarget.value; return next; })} fullWidth /></div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {items.map((item) => <Button key={item.id || item.code} type="button" variant="ghost" className={["h-auto min-h-10 w-full justify-between rounded-lg px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-0", activePath[columnIndex]?.code === item.code ? "bg-[var(--color-bg-hover)]" : ""].join(" ")} onPress={() => void selectItem(item, columnIndex)}><LocationOptionContent item={item} />{item.depth < maxDepth ? <span aria-hidden="true" className="ml-2 text-[var(--color-text-secondary)]">&gt;</span> : null}</Button>)}
                {!isLoading && items.length === 0 ? <div className="px-2 py-5 text-center text-xs text-[var(--color-text-secondary)]">{loadError || (searches[columnIndex]?.trim() ? "没有匹配的地区" : "没有地区数据")}</div> : null}
              </div>
            </div>)}
          </div>
          <div className="flex items-center justify-between border-t border-[var(--color-border)] p-2"><span className="min-w-0 truncate text-xs text-[var(--color-text-secondary)]">{activePath.map((item) => getLocationLabel(item)).join(" / ") || `请选择第 ${maxDepth} 级地区`}</span><Button type="button" size="sm" isDisabled={activePath.length === 0 || (activePath.length < maxDepth && !selectionIsLeaf)} onPress={() => { const selected = activePath.at(-1); if (!selected) return; onChange({ code: selected.code, depth: selected.depth, path: activePath.map(toStoredLocationItem) }, "onChange"); setIsOpen(false); }}>确认</Button></div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function matchesLocationSearch(item: LocationCatalogItem, query: string) {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return true;
  return item.name.toLocaleLowerCase().includes(keyword)
    || Object.values(item.labels ?? {}).some((label) => label.toLocaleLowerCase().includes(keyword))
    || item.code.toLocaleLowerCase().includes(keyword);
}

function LocationOptionContent({ item }: { item: LocationCatalogItem }) {
  const label = getLocationLabel(item);
  return (
    <span className="flex min-w-0 flex-col py-0.5">
      <span className="truncate text-sm text-[var(--color-text-primary)]">{label}</span>
      <span className="truncate text-xs text-[var(--color-text-secondary)]">{item.name}</span>
    </span>
  );
}

export function RuntimeCheckboxOptions({
  ariaLabel,
  className,
  isDisabled,
  isRequired,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  className?: string;
  isDisabled: boolean;
  isRequired?: boolean;
  onChange: (value: string[]) => void;
  options: RuntimeFieldOption[];
  value: string[];
}) {
  return (
    <div aria-label={ariaLabel} className={className} role="group">
      {options.map((option) => {
        const isSelected = value.includes(option.value);
        return (
          <label key={option.value} className={["inline-flex items-center gap-2 text-[12px] text-[var(--color-text-primary)]", isDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"].join(" ")}>
            <input
              aria-required={isRequired || undefined}
              type="checkbox"
              value={option.value}
              checked={isSelected}
              disabled={isDisabled}
              onChange={(event) => onChange(event.target.checked ? [...value, option.value] : value.filter((item) => item !== option.value))}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export function RuntimeMultiSelect({
  field,
  onChange,
  options,
  placeholder,
  props,
  value,
}: {
  field: RuntimeSchemaField;
  onChange: (value: string[]) => void;
  options: RuntimeFieldOption[];
  placeholder: string;
  props: RuntimeFieldProps;
  value: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabels = value.map((item) => getOptionLabel(options, item)).filter(Boolean);

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
        onClick={() => setIsOpen((current) => !current)}
        className="min-h-10 w-full justify-start rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-left text-sm text-[var(--color-text-primary)]"
      >
        {selectedLabels.length > 0 ? selectedLabels.join("、") : placeholder}
      </Button>
      {isOpen ? (
        <div className="absolute z-30 mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 shadow-[var(--shadow-floating)]">
          <RuntimeCheckboxOptions
            ariaLabel={field.label}
            value={value}
            onChange={onChange}
            options={options}
            isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
            isRequired={props.isRequired}
          />
        </div>
      ) : null}
    </div>
  );
}

export function RuntimeUpload({
  field,
  props,
  value,
  onFilesCommitted,
}: {
  field: RuntimeSchemaField;
  props: RuntimeFieldProps;
  value: unknown;
  onFilesCommitted: (files: UploadedRuntimeFile[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isDisabled = Boolean(props.isDisabled || props.isReadOnly);
  const [isUploading, setIsUploading] = useState(false);
  const files = normalizeUploadedRuntimeFiles(value);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (selectedFiles.length === 0) return;
    if (field.type === "imageUpload" && selectedFiles.some((file) => !file.type.startsWith("image/"))) {
      toast.danger("请选择图片文件");
      return;
    }
    const maxBytes = (props.maxFileSizeMb ?? 20) * 1024 * 1024;
    if (selectedFiles.some((file) => file.size > maxBytes)) {
      toast.danger("文件超过大小限制", { description: `单个文件不能超过 ${props.maxFileSizeMb ?? 20} MB。` });
      return;
    }
    setIsUploading(true);
    try {
      const uploaded = await Promise.all(selectedFiles.map(uploadRuntimeFile));
      onFilesCommitted(props.multiple ? [...files, ...uploaded] : uploaded.slice(0, 1));
    } catch (error) {
      toast.danger("文件上传失败", { description: error instanceof Error ? error.message : "请稍后重试。" });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="block rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
      <Button
        type="button"
        variant="ghost"
        isDisabled={isDisabled || isUploading}
        onClick={() => inputRef.current?.click()}
        className="h-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)]"
      >
        {props.buttonText || props.placeholder || "上传"}
      </Button>
      <input
        ref={inputRef}
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        type="file"
        name={field.id}
        accept={props.accept}
        multiple={props.multiple}
        disabled={isDisabled}
        required={props.isRequired}
        tabIndex={-1}
        onChange={handleFileChange}
      />
      {files.length > 0 ? <div className={field.type === "imageUpload" ? "mt-3 grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2" : "mt-2 space-y-1"}>{files.map((file) => field.type === "imageUpload" ? <div key={file.fileId} className="relative min-w-0 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)]"><Image src={`/api/files/${encodeURIComponent(file.fileId)}/download`} alt={file.name} width={112} height={80} unoptimized className="h-20 w-full object-cover" /><div className="truncate px-2 py-1 text-xs text-[var(--color-text-secondary)]" title={file.name}>{file.name}</div><button type="button" aria-label={`删除${file.name}`} className="absolute right-1 top-1 h-5 w-5 rounded bg-black/60 text-xs text-white" disabled={isDisabled || isUploading} onClick={() => onFilesCommitted(files.filter((item) => item.fileId !== file.fileId))}>×</button></div> : <div key={file.fileId} className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]"><a className="min-w-0 truncate text-[var(--color-primary)]" href={`/api/files/${encodeURIComponent(file.fileId)}/download`} target="_blank" rel="noreferrer">{file.name}</a><span className="shrink-0">{formatFileSize(file.size)}</span><button type="button" aria-label={`删除${file.name}`} className="shrink-0 text-[var(--color-danger)]" disabled={isDisabled || isUploading} onClick={() => onFilesCommitted(files.filter((item) => item.fileId !== file.fileId))}>删除</button></div>)}</div> : null}
    </div>
  );
}

type UploadedRuntimeFile = { fileId: string; name: string; size: number; mimeType: string };

async function uploadRuntimeFile(file: File): Promise<UploadedRuntimeFile> {
  return uploadFile<UploadedRuntimeFile>(file);
}

function normalizeUploadedRuntimeFiles(value: unknown): UploadedRuntimeFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is UploadedRuntimeFile => Boolean(item && typeof item === "object" && typeof (item as UploadedRuntimeFile).fileId === "string"));
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function RuntimeDateRangePicker({
  field,
  props,
  value,
  onChange,
}: {
  field: RuntimeSchemaField;
  props: RuntimeFieldProps;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const defaultValue = getDateRangeValue(value);

  return (
    <DateRangePicker
      aria-label={field.label}
      className={styles["form-runtime-controls__date-range-picker"]}
      defaultValue={defaultValue as never}
      isDisabled={props.isDisabled}
      isReadOnly={props.isReadOnly}
      onChange={(nextValue: { start: { toString: () => string }; end: { toString: () => string } } | null) =>
        onChange(nextValue ? [nextValue.start.toString(), nextValue.end.toString()] : [])
      }
    >
      <DateInputGroup fullWidth>
        <DateInputGroup.InputContainer>
          <DateInputGroup.Input slot="start">
            {(segment) => <DateInputGroup.Segment segment={segment} />}
          </DateInputGroup.Input>
          <DateRangePicker.RangeSeparator>-</DateRangePicker.RangeSeparator>
          <DateInputGroup.Input slot="end">
            {(segment) => <DateInputGroup.Segment segment={segment} />}
          </DateInputGroup.Input>
        </DateInputGroup.InputContainer>
        <DateInputGroup.Suffix>
          <DateRangePicker.Trigger>
            <DateRangePicker.TriggerIndicator />
          </DateRangePicker.Trigger>
        </DateInputGroup.Suffix>
      </DateInputGroup>
      <DateRangePicker.Popover>
        <RangeCalendar>
          <RangeCalendar.Header>
            <RangeCalendar.NavButton slot="previous" />
            <RangeCalendar.Heading />
            <RangeCalendar.NavButton slot="next" />
          </RangeCalendar.Header>
          <RangeCalendar.Grid>
            <RangeCalendar.GridHeader>
              {(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}
            </RangeCalendar.GridHeader>
            <RangeCalendar.GridBody>
              {(date) => <RangeCalendar.Cell date={date} />}
            </RangeCalendar.GridBody>
          </RangeCalendar.Grid>
        </RangeCalendar>
      </DateRangePicker.Popover>
    </DateRangePicker>
  );
}

export function RuntimeClearButton({
  isDisabled,
  onClear,
}: {
  isDisabled: boolean;
  onClear: () => void;
}) {
  return (
    <Button
      type="button"
      isIconOnly
      aria-label="清除"
      isDisabled={isDisabled}
      onClick={onClear}
      className="absolute right-2 top-2 h-5 w-5 rounded-full bg-[var(--color-bg-subtle)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-soft)]"
    >
      ×
    </Button>
  );
}

export function Counter({ value }: { value: string }) {
  return (
    <div className="pointer-events-none absolute -bottom-5 right-0 text-xs text-[var(--color-text-disabled)]">
      {value.length}/500
    </div>
  );
}
