"use client";
import { notifyRequestError } from "@lib/notify";
import { notify } from "@lib/notify";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ComponentProps, Key } from "react";
import Image from "next/image";
import {
  Button,
  Calendar,
  DatePicker,
  FieldError,
  DateRangePicker,
  Input,
  ListBox,
  Popover,
  RangeCalendar,
  Select,
  TimeField,
  Label,
  Link,
  Spinner,
} from "@heroui/react";
import { DateInputGroup } from "@heroui/react/date-input-group";
import { ChevronDown, Paperclip, Picture, TrashBin } from "@gravity-ui/icons";
import {
  parseDate,
  parseDateTime,
  parseZonedDateTime,
  toCalendarDate,
  toCalendarDateTime,
} from "@internationalized/date";
import { getDateBounds, getDateValidation } from "./date-validation";
import { uploadFile } from "@features/files/api";
import {
  getLocationLabel,
  listLocationChildren,
  normalizeCountryCityValue,
  toStoredLocationItem,
  type CountryCityValue,
  type LocationCatalogItem,
} from "@lib/location-catalog";
import type {
  RuntimeFieldOption,
  RuntimeFieldProps,
  RuntimeSchemaField,
} from "./runtime-form-types";
import { MySurface } from "@/components/ui/MySurface";

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

function getDateValue(
  value: string,
  granularity: RuntimeFieldProps["granularity"] = "day",
) {
  try {
    if (!value) return null;
    const parsed = value.includes("[")
      ? parseZonedDateTime(value)
      : value.includes("T")
        ? parseDateTime(value)
        : parseDate(value);
    return granularity === "day"
      ? toCalendarDate(parsed)
      : "hour" in parsed
        ? parsed
        : toCalendarDateTime(parsed);
  } catch {
    return null;
  }
}

export function RuntimeDatePicker({
  field,
  errorMessage,
  props,
  value,
  onChange,
}: {
  field: Pick<RuntimeSchemaField, "id" | "label">;
  errorMessage?: string;
  props: RuntimeFieldProps;
  value: string;
  onChange: (value: string) => void;
}) {
  const bounds = getDateBounds(getDateValidation(props));
  return (
    <DatePicker
      style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
      minValue={
        bounds.minValue as unknown as ComponentProps<
          typeof DatePicker
        >["minValue"]
      }
      maxValue={
        bounds.maxValue as unknown as ComponentProps<
          typeof DatePicker
        >["maxValue"]
      }
      key={props.granularity ?? "day"}
      aria-label={field.label}
      isRequired={props.isRequired}
      isInvalid={Boolean(errorMessage)}
      validationBehavior="aria"
      value={
        getDateValue(value, props.granularity) as ComponentProps<
          typeof DatePicker
        >["value"]
      }
      granularity={props.granularity ?? "day"}
      hourCycle={props.hourCycle}
      hideTimeZone={props.hideTimeZone}
      shouldForceLeadingZeros={props.shouldForceLeadingZeros}
      onChange={(nextValue) => onChange(nextValue?.toString() ?? "")}
      isDisabled={props.isDisabled}
      isReadOnly={props.isReadOnly}
      shouldCloseOnSelect={(props.granularity ?? "day") === "day"}
    >
      {({ state }) => (
        <>
          <DateInputGroup fullWidth>
            <DateInputGroup.InputContainer style={{ minWidth: 0, width: 0 }}>
              <DateInputGroup.Input>
                {(segment) => <DateInputGroup.Segment segment={segment} />}
              </DateInputGroup.Input>
            </DateInputGroup.InputContainer>
            <DateInputGroup.Suffix>
              <DatePicker.Trigger>
                <DatePicker.TriggerIndicator />
              </DatePicker.Trigger>
            </DateInputGroup.Suffix>
          </DateInputGroup>
          <DatePicker.Popover>
            <Calendar>
              <Calendar.Header>
                <Calendar.NavButton slot="previous" />
                <Calendar.YearPickerTrigger>
                  <Calendar.YearPickerTriggerHeading />
                  <Calendar.YearPickerTriggerIndicator />
                </Calendar.YearPickerTrigger>
                <Calendar.NavButton slot="next" />
              </Calendar.Header>
              <Calendar.YearPickerGrid>
                <Calendar.YearPickerGridBody>
                  {({ year }) => <Calendar.YearPickerCell year={year} />}
                </Calendar.YearPickerGridBody>
              </Calendar.YearPickerGrid>
              <Calendar.Grid>
                <Calendar.GridHeader>
                  {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
                </Calendar.GridHeader>
                <Calendar.GridBody>
                  {(date) => <Calendar.Cell date={date} />}
                </Calendar.GridBody>
              </Calendar.Grid>
            </Calendar>
            {props.granularity && props.granularity !== "day" ? (
              <TimeField
                aria-label={`${field.label}时间`}
                granularity={props.granularity}
                hourCycle={props.hourCycle}
                hideTimeZone={props.hideTimeZone}
                shouldForceLeadingZeros={props.shouldForceLeadingZeros}
                value={state.timeValue}
                onChange={(time) => {
                  if (time) state.setTimeValue(time);
                }}
                isDisabled={props.isDisabled}
                isReadOnly={props.isReadOnly}
              >
                <Label>时间</Label>
                <TimeField.Group>
                  <TimeField.Input>
                    {(segment) => <TimeField.Segment segment={segment} />}
                  </TimeField.Input>
                </TimeField.Group>
              </TimeField>
            ) : null}
          </DatePicker.Popover>
          <FieldError>{errorMessage}</FieldError>
        </>
      )}
    </DatePicker>
  );
}

export function RuntimeSelect({
  field,
  errorMessage,
  onChange,
  options,
  placeholder,
  props,
  value,
}: {
  field: RuntimeSchemaField;
  errorMessage?: string;
  onChange: (value: string) => void;
  options: RuntimeFieldOption[];
  placeholder: string;
  props: RuntimeFieldProps;
  value: string;
}) {
  return (
    <Select
      aria-label={field.label}
      isInvalid={Boolean(errorMessage)}
      validationBehavior="aria"
      selectedKey={value || null}
      onSelectionChange={(key: Key | null) =>
        onChange(key === null ? "" : String(key))
      }
      isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
      isRequired={props.isRequired}
      fullWidth
    >
      <Select.Trigger>
        <Select.Value>
          {getOptionLabel(options, value) || placeholder}
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={option.value}
              id={option.value}
              textValue={option.label}
            >
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
      <FieldError>{errorMessage}</FieldError>
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
  const maxDepth = Math.min(
    4,
    Math.max(1, Math.round(props.locationDepth ?? 3)),
  );
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
  const filteredColumns = useMemo(
    () =>
      columns.map((items, columnIndex) => ({
        columnIndex,
        items: searches[columnIndex]?.trim()
          ? items.filter((item) =>
              matchesLocationSearch(item, searches[columnIndex]),
            )
          : items,
      })),
    [columns, searches],
  );

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
    return () => {
      active = false;
    };
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
      setColumns((current) =>
        children.length > 0
          ? [...current.slice(0, columnIndex + 1), children]
          : current.slice(0, columnIndex + 1),
      );
    } catch {
      setSelectionIsLeaf(true);
      setColumns((current) => current.slice(0, columnIndex + 1));
      setLoadError("地区目录加载失败");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={(next) => !isDisabled && setIsOpen(next)}
    >
      <Popover.Trigger
        aria-label={field.label}
        className="block w-full"
        tabIndex={isDisabled ? -1 : 0}
      >
        <div className="relative w-full">
          <Input
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-label={field.label}
            className="pointer-events-none h-9 pr-10"
            disabled={isDisabled}
            placeholder={props.placeholder || "请选择国家/地区"}
            readOnly
            value={
              selectedPath.length > 0
                ? selectedPath.map((item) => getLocationLabel(item)).join(" / ")
                : ""
            }
            fullWidth
          />
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-[var(--color-text-disabled)]"
          />
        </div>
      </Popover.Trigger>
      <Popover.Content className="w-max max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-[var(--color-bg-surface)] p-0 shadow-[var(--shadow-floating)]">
        <Popover.Dialog
          aria-label={`${field.label}国家地区选择`}
          className="min-w-0 max-w-[calc(100vw-2rem)]"
        >
          <div className="flex min-w-0 max-w-full overflow-x-auto" role="listbox">
            {filteredColumns.map(({ items, columnIndex }) => (
              <div
                key={columnIndex}
                className="flex h-72 w-max min-w-36 max-w-[min(12rem,calc(100vw-4rem))] shrink-0 flex-col border-r border-[var(--color-border)] last:border-r-0"
              >
                <div className="relative h-13 shrink-0">
                  <div className="absolute inset-x-1.5 inset-y-2">
                  <Input
                    aria-label={`搜索第${columnIndex + 1}级地区`}
                    placeholder={`搜索第${columnIndex + 1}级地区`}
                    value={searches[columnIndex] ?? ""}
                    onChange={(event) =>
                      setSearches((current) => {
                        const next = [...current];
                        next[columnIndex] = event.currentTarget.value;
                        return next;
                      })
                    }
                    fullWidth
                  />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-1">
                  {items.map((item) => (
                    <Button
                      key={item.id || item.code}
                      type="button"
                      variant="ghost"
                      className={[
                        "h-auto min-h-10 w-full min-w-0 justify-between gap-1 rounded-lg px-1.5 py-1 text-left focus-visible:outline-none focus-visible:ring-0",
                        activePath[columnIndex]?.code === item.code
                          ? "bg-[var(--color-bg-hover)]"
                          : "",
                      ].join(" ")}
                      onPress={() => void selectItem(item, columnIndex)}
                    >
                      <LocationOptionContent item={item} />
                      {item.depth < maxDepth ? (
                        <span
                          aria-hidden="true"
                          className="ml-1 shrink-0 text-[var(--color-text-secondary)]"
                        >
                          &gt;
                        </span>
                      ) : null}
                    </Button>
                  ))}
                  {!isLoading && items.length === 0 ? (
                    <div className="px-2 py-5 text-center text-xs text-[var(--color-text-secondary)]">
                      {loadError ||
                        (searches[columnIndex]?.trim()
                          ? "没有匹配的地区"
                          : "没有地区数据")}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <MySurface className="mt-2 flex items-center justify-between gap-3 p-2 [contain:inline-size]">
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-secondary)]">
              {activePath.map((item) => getLocationLabel(item)).join(" / ") ||
                `请选择第 ${maxDepth} 级地区`}
            </span>
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              isDisabled={
                activePath.length === 0 ||
                (activePath.length < maxDepth && !selectionIsLeaf)
              }
              onPress={() => {
                const selected = activePath.at(-1);
                if (!selected) return;
                onChange(
                  {
                    code: selected.code,
                    depth: selected.depth,
                    path: activePath.map(toStoredLocationItem),
                  },
                  "onChange",
                );
                setIsOpen(false);
              }}
            >
              确认
            </Button>
          </MySurface>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function matchesLocationSearch(item: LocationCatalogItem, query: string) {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return true;
  return (
    item.name.toLocaleLowerCase().includes(keyword) ||
    Object.values(item.labels ?? {}).some((label) =>
      label.toLocaleLowerCase().includes(keyword),
    ) ||
    item.code.toLocaleLowerCase().includes(keyword)
  );
}

function LocationOptionContent({ item }: { item: LocationCatalogItem }) {
  const label = getLocationLabel(item);
  return (
    <span className="flex min-w-0 flex-col py-0.5">
      <span className="truncate text-sm text-[var(--color-text-primary)]">
        {label}
      </span>
      <span className="truncate text-xs text-[var(--color-text-secondary)]">
        {item.name}
      </span>
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
          <label
            key={option.value}
            className={[
              "inline-flex items-center gap-2 text-[12px] text-[var(--color-text-primary)]",
              isDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            ].join(" ")}
          >
            <input
              aria-required={isRequired || undefined}
              type="checkbox"
              value={option.value}
              checked={isSelected}
              disabled={isDisabled}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, option.value]
                    : value.filter((item) => item !== option.value),
                )
              }
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
  errorMessage,
  onChange,
  options,
  placeholder,
  props,
  value,
}: {
  field: RuntimeSchemaField;
  errorMessage?: string;
  onChange: (value: string[]) => void;
  options: RuntimeFieldOption[];
  placeholder: string;
  props: RuntimeFieldProps;
  value: string[];
}) {
  const selectedLabels = value
    .map((item) => getOptionLabel(options, item))
    .filter(Boolean);

  return (
    <Select
      aria-label={field.label}
      isInvalid={Boolean(errorMessage)}
      validationBehavior="aria"
      selectionMode="multiple"
      value={value}
      onChange={(keys) => onChange(keys.map(String))}
      shouldCloseOnSelect={false}
      isDisabled={Boolean(props.isDisabled || props.isReadOnly)}
      isRequired={props.isRequired}
      placeholder={placeholder}
      fullWidth
    >
      <Select.Trigger className="min-w-0">
        <Select.Value className="min-w-0 flex-1 truncate">
          {selectedLabels.length > 0 ? selectedLabels.join("、") : placeholder}
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox selectionMode="multiple">
          {options.map((option) => (
            <ListBox.Item
              key={option.value}
              id={option.value}
              textValue={option.label}
            >
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
      <FieldError>{errorMessage}</FieldError>
    </Select>
  );
}

export function UploadSurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      {children}
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
  const fillsImageHeight =
    field.type === "imageUpload" && (field.rowSpan ?? 1) > 1;

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (selectedFiles.length === 0) return;
    if (
      field.type === "imageUpload" &&
      selectedFiles.some((file) => !file.type.startsWith("image/"))
    ) {
      notify.error("请选择图片文件");
      return;
    }
    const maxBytes = (props.maxFileSizeMb ?? 20) * 1024 * 1024;
    if (selectedFiles.some((file) => file.size > maxBytes)) {
      notify.error("文件超过大小限制", {
        description: `单个文件不能超过 ${props.maxFileSizeMb ?? 20} MB。`,
      });
      return;
    }
    setIsUploading(true);
    try {
      const uploaded = await Promise.all(selectedFiles.map(uploadRuntimeFile));
      onFilesCommitted(
        props.multiple ? [...files, ...uploaded] : uploaded.slice(0, 1),
      );
    } catch (error) {
      notifyRequestError(error, "文件上传失败", {
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <UploadSurface>
      <Button
        type="button"
        variant="secondary"
        isDisabled={isDisabled || isUploading}
        onPress={() => inputRef.current?.click()}
        className={
          fillsImageHeight && files.length === 0
            ? "h-auto min-h-9 w-full max-w-full flex-1"
            : "max-w-full shrink-0 self-start"
        }
      >
        {isUploading ? (
          <Spinner size="sm" />
        ) : field.type === "imageUpload" ? (
          <Picture />
        ) : (
          <Paperclip />
        )}
        <span className="truncate">
          {isUploading
            ? "正在上传…"
            : props.buttonText || props.placeholder || "上传"}
        </span>
      </Button>
      <input
        ref={inputRef}
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        type="file"
        name={field.id}
        accept={
          props.accept || (field.type === "imageUpload" ? "image/*" : undefined)
        }
        multiple={props.multiple}
        disabled={isDisabled}
        tabIndex={-1}
        onChange={handleFileChange}
      />
      {files.length > 0 ? (
        <div
          className={
            field.type === "imageUpload"
              ? "mt-2 min-h-0 flex-1 grid grid-cols-[repeat(auto-fill,minmax(min(112px,100%),1fr))] gap-2"
              : "mt-2 min-h-0 flex-1 space-y-1"
          }
        >
          {files.map((file) =>
            field.type === "imageUpload" ? (
              <div
                key={file.fileId}
                className="flex min-h-0 min-w-0 flex-col overflow-hidden"
                style={{
                  borderRadius: "var(--radius)",
                  background: "var(--surface)",
                }}
              >
                <Image
                  src={`/api/files/${encodeURIComponent(file.fileId)}/download`}
                  alt={file.name}
                  width={112}
                  height={80}
                  unoptimized
                  className={
                    fillsImageHeight
                      ? "min-h-20 w-full flex-1 object-contain h-0"
                      : "h-20 w-full object-cover"
                  }
                />
                <div className="flex min-w-0 shrink-0 items-center gap-1 px-1 py-0.5">
                  <Link
                    className="min-w-0 flex-1 truncate text-xs"
                    href={`/api/files/${encodeURIComponent(file.fileId)}/download`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={file.name}
                  >
                    {file.name}
                  </Link>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    isIconOnly
                    aria-label={`删除${file.name}`}
                    style={{ color: "var(--danger)" }}
                    isDisabled={isDisabled || isUploading}
                    onPress={() =>
                      onFilesCommitted(
                        files.filter((item) => item.fileId !== file.fileId),
                      )
                    }
                  >
                    <TrashBin />
                  </Button>
                </div>
              </div>
            ) : (
              <div
                key={file.fileId}
                className="flex min-w-0 items-center gap-1 px-1 py-0.5 text-xs"
                style={{
                  background: "var(--surface)",
                  borderRadius: "var(--radius)",
                  color: "var(--muted)",
                }}
              >
                <Paperclip className="shrink-0" />
                <Link
                  className="min-w-0 flex-1 truncate text-xs"
                  href={`/api/files/${encodeURIComponent(file.fileId)}/download`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {file.name}
                </Link>
                <span className="shrink-0">{formatFileSize(file.size)}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  isIconOnly
                  aria-label={`删除${file.name}`}
                  style={{ color: "var(--danger)" }}
                  isDisabled={isDisabled || isUploading}
                  onPress={() =>
                    onFilesCommitted(
                      files.filter((item) => item.fileId !== file.fileId),
                    )
                  }
                >
                  <TrashBin />
                </Button>
              </div>
            ),
          )}
        </div>
      ) : null}
    </UploadSurface>
  );
}

type UploadedRuntimeFile = {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
};

async function uploadRuntimeFile(file: File): Promise<UploadedRuntimeFile> {
  return uploadFile(file);
}

function normalizeUploadedRuntimeFiles(value: unknown): UploadedRuntimeFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is UploadedRuntimeFile =>
    Boolean(
      item &&
      typeof item === "object" &&
      typeof (item as UploadedRuntimeFile).fileId === "string",
    ),
  );
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function RuntimeDateRangePicker({
  field,
  errorMessage,
  props,
  value,
  onChange,
}: {
  field: Pick<RuntimeSchemaField, "id" | "label">;
  errorMessage?: string;
  props: RuntimeFieldProps;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const selectedValue = getDateRangeValue(value);
  const bounds = getDateBounds(getDateValidation(props));

  return (
    <DateRangePicker
      style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
      minValue={
        bounds.minValue as unknown as ComponentProps<
          typeof DateRangePicker
        >["minValue"]
      }
      maxValue={
        bounds.maxValue as unknown as ComponentProps<
          typeof DateRangePicker
        >["maxValue"]
      }
      aria-label={field.label}
      isRequired={props.isRequired}
      isInvalid={Boolean(errorMessage)}
      validationBehavior="aria"
      value={
        (selectedValue ?? null) as ComponentProps<
          typeof DateRangePicker
        >["value"]
      }
      isDisabled={props.isDisabled}
      isReadOnly={props.isReadOnly}
      onChange={(
        nextValue: {
          start: { toString: () => string };
          end: { toString: () => string };
        } | null,
      ) =>
        onChange(
          nextValue
            ? [nextValue.start.toString(), nextValue.end.toString()]
            : [],
        )
      }
    >
      <DateInputGroup fullWidth>
        <DateInputGroup.InputContainer style={{ minWidth: 0, width: 0 }}>
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
            <RangeCalendar.YearPickerTrigger>
              <RangeCalendar.YearPickerTriggerHeading />
              <RangeCalendar.YearPickerTriggerIndicator />
            </RangeCalendar.YearPickerTrigger>
            <RangeCalendar.NavButton slot="next" />
          </RangeCalendar.Header>
          <RangeCalendar.YearPickerGrid>
            <RangeCalendar.YearPickerGridBody>
              {({ year }) => <RangeCalendar.YearPickerCell year={year} />}
            </RangeCalendar.YearPickerGridBody>
          </RangeCalendar.YearPickerGrid>
          <RangeCalendar.Grid>
            <RangeCalendar.GridHeader>
              {(day) => (
                <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>
              )}
            </RangeCalendar.GridHeader>
            <RangeCalendar.GridBody>
              {(date) => <RangeCalendar.Cell date={date} />}
            </RangeCalendar.GridBody>
          </RangeCalendar.Grid>
        </RangeCalendar>
      </DateRangePicker.Popover>
      <FieldError>{errorMessage}</FieldError>
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
