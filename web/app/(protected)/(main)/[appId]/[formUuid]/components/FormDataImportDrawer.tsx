"use client";

import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { ArrowDownToLine } from "@gravity-ui/icons";
import {
  Badge,
  Button,
  Drawer,
  Input,
  ListBox,
  ProgressBar,
  Select,
  Tag,
  TagGroup,
  Table,
} from "@heroui/react";
import { MySurface } from "@shared/ui/MySurface";
import { getMissingRequiredImportFields } from "@features/records/model/excel-import";
import { getViewFieldTypeLabel } from "@features/records/model/excel-association";

export type ImportWorkbookState = {
  fileName: string;
  sheetName?: string;
  sheetNames?: string[];
  loading?: boolean;
  headers: string[];
  rows: unknown[][];
  rowGroups?: number[];
  mappings: Record<number, string>;
  progress: number;
  successCount: number;
  failureCount: number;
  importing: boolean;
  completed: boolean;
};

type ImportField = {
  id: string;
  label: string;
  type: string;
  subformId?: string;
  props?: { isRequired?: boolean };
};

function FieldTypeTag({ type }: { type: string }) {
  const label = getViewFieldTypeLabel(type);
  return (
    <TagGroup aria-label="字段组件类型" selectionMode="none" className="inline-flex shrink-0">
      <TagGroup.List>
        <Tag
          id={type}
          textValue={label}
          className="!min-h-5 !cursor-default !px-2 !py-0.5 !text-[10px]"
          style={{
            color: `var(--field-type-${type}-foreground, var(--field-type-default-foreground))`,
            backgroundColor: `var(--field-type-${type}-background, var(--field-type-default-background))`,
          }}
        >
          {label}
        </Tag>
      </TagGroup.List>
    </TagGroup>
  );
}

type FormDataImportDrawerProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  state: ImportWorkbookState;
  setState: Dispatch<SetStateAction<ImportWorkbookState>>;
  fields: readonly ImportField[];
  builtinFieldLabels: ReadonlySet<string>;
  onDownloadTemplate: () => void | Promise<void>;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onSheetChange: (sheetName: string) => void | Promise<void>;
  onImport: () => void | Promise<void>;
};

export function FormDataImportDrawer({
  isOpen,
  onOpenChange,
  state,
  setState,
  fields,
  builtinFieldLabels,
  onDownloadTemplate,
  onFileChange,
  onImport,
  onSheetChange,
}: FormDataImportDrawerProps) {
  const missingRequiredIds = new Set(getMissingRequiredImportFields(fields, state.mappings));
  const missingRequiredLabels = fields.filter((field) => missingRequiredIds.has(field.id)).map((field) => field.label);
  return (
    <Drawer.Backdrop
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className="theme-modal-backdrop"
      isDismissable={false}
    >
      <Drawer.Content placement="right" className="!justify-end">
        <Drawer.Dialog className="flex h-[100dvh] !w-[90vw] !max-w-[90vw] flex-col overflow-hidden">
          <Drawer.Header>
            <div>
              <Drawer.Heading>导入表单数据</Drawer.Heading>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                按分组完成上传、字段匹配和导入。
              </p>
            </div>
            <Drawer.CloseTrigger
              aria-label="关闭导入"
              isDisabled={state.importing}
            />
          </Drawer.Header>
          <Drawer.Body className="min-w-0 space-y-6">
            <MySurface className="space-y-4 p-4">
              <div className="flex items-start gap-3">
                <Badge
                  color="accent"
                  className="!static !translate-x-0 !translate-y-0"
                >
                  1
                </Badge>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    上传 Excel
                  </h3>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    支持普通表头及宜搭两级表头；合并的主表数据会归为一条记录。
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                onPress={() => void onDownloadTemplate()}
              >
                <ArrowDownToLine className="h-4 w-4" />
                下载 Excel 模板
              </Button>
              <Input
                key={state.fileName || "empty-import-file"}
                fullWidth
                type="file"
                accept=".xlsx,.xls"
                aria-label="上传导入 Excel"
                disabled={state.importing || state.loading}
                onChange={onFileChange}
              />
              {state.fileName ? (
                <div className="rounded-lg border border-[var(--color-success)] bg-[var(--color-success-soft)] px-3 py-2 text-xs text-[var(--color-success)]">
                  已读取 {state.fileName}，共{" "}
                  {
                    new Set(
                      state.rowGroups ?? state.rows.map((_, index) => index),
                    ).size
                  }{" "}
                  条主记录、{state.rows.length} 行数据、
                  {state.headers.length} 列
                </div>
              ) : null}
            </MySurface>

            <MySurface
              className={`min-w-0 max-w-full space-y-4 p-4 ${state.rows.length === 0 ? "opacity-60" : ""}`}
            >
              <div className="flex items-start gap-3">
                <Badge
                  color={state.rows.length ? "accent" : "default"}
                  className="!static !translate-x-0 !translate-y-0"
                >
                  2
                </Badge>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    匹配导入字段
                  </h3>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    表头为目标表单字段，下方选择对应的 Excel 列并预览数据；不需要导入的字段可跳过。
                  </p>
                </div>
              </div>
              {state.sheetNames?.length ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[var(--color-text-secondary)]">工作表</span>
                  <Select className="w-64" aria-label="选择 Excel 工作表" selectedKey={state.sheetName ?? null}
                    isDisabled={state.importing || state.loading}
                    onSelectionChange={(key) => { if (key !== null) void onSheetChange(String(key)); }}>
                    <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                    <Select.Popover><ListBox>{state.sheetNames.map((name) => <ListBox.Item key={name} id={name} textValue={name}>{name}</ListBox.Item>)}</ListBox></Select.Popover>
                  </Select>
                  <span role="status" className="text-xs text-[var(--color-text-secondary)]">{state.loading ? "正在读取工作表…" : `共 ${state.rows.length} 行，最多预览前 10 行；导入时处理全部数据。`}</span>
                </div>
              ) : null}
              {state.fileName && fields.length > 0 ? (
                <Table className="min-w-0 max-w-full">
                  <Table.ScrollContainer className="max-h-[55vh] overflow-x-scroll overflow-y-auto">
                    <Table.Content aria-label="导入字段匹配及数据预览" className="table-fixed" style={{ minWidth: fields.length * 240 }}>
                      <Table.Header>
                        {fields.map((field, index) => (
                          <Table.Column key={field.id} id={field.id} isRowHeader={index === 0} width={240}>
                            <div className="flex items-center gap-2">
                              <span title={field.label} className="min-w-0 truncate">{field.label}</span>
                              {field.props?.isRequired ? <span aria-label="必填" className="text-[var(--color-danger)]">*</span> : null}
                              <FieldTypeTag type={field.type} />
                            </div>
                          </Table.Column>
                        ))}
                      </Table.Header>
                      <Table.Body>
                        <Table.Row id="mapping">
                          {fields.map((field) => {
                            const matchedColumn = Object.entries(state.mappings).find(([, id]) => id === field.id)?.[0];
                            return <Table.Cell key={field.id}>
                        <Select
                          className="min-w-0"
                          aria-label={`为目标字段 ${field.label} 选择 Excel 列`}
                          isRequired={field.props?.isRequired}
                          isInvalid={missingRequiredIds.has(field.id)}
                          isDisabled={state.importing || state.completed || state.loading}
                          selectedKey={matchedColumn === undefined ? "__ignore__" : `column:${matchedColumn}`}
                          onSelectionChange={(key) => setState((current) => {
                            const mappings = { ...current.mappings };
                            for (const [column, fieldId] of Object.entries(mappings)) {
                              if (fieldId === field.id) mappings[Number(column)] = "";
                            }
                            if (key !== null && String(key).startsWith("column:")) {
                              mappings[Number(String(key).slice(7))] = field.id;
                            }
                            return { ...current, mappings };
                          })}
                        >
                          <Select.Trigger>
                            <Select.Value>
                              {matchedColumn === undefined ? "不导入此字段" : state.headers[Number(matchedColumn)] || `未命名列 ${Number(matchedColumn) + 1}`}
                            </Select.Value>
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              <ListBox.Item id="__ignore__" textValue="不导入此字段">不导入此字段</ListBox.Item>
                              {state.headers.map((header, columnIndex) => (
                                <ListBox.Item
                                  key={columnIndex}
                                  id={`column:${columnIndex}`}
                                  textValue={header || `未命名列 ${columnIndex + 1}`}
                                  isDisabled={builtinFieldLabels.has(header) || Boolean(state.mappings[columnIndex] && state.mappings[columnIndex] !== field.id)}
                                >
                                  {header || `未命名列 ${columnIndex + 1}`}
                                </ListBox.Item>
                              ))}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                            </Table.Cell>;
                          })}
                        </Table.Row>
                        <Table.Collection items={state.rows.slice(0, 10).map((row, index) => ({ id: `preview:${index}`, row }))}>
                          {(item) => <Table.Row id={item.id}>
                            {fields.map((field) => {
                              const column = Object.entries(state.mappings).find(([, id]) => id === field.id)?.[0];
                              const value = column === undefined ? "" : String(item.row[Number(column)] ?? "");
                              return <Table.Cell key={field.id}><div title={value} className="max-w-[208px] truncate">{value || "—"}</div></Table.Cell>;
                            })}
                          </Table.Row>}
                        </Table.Collection>
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              ) : <p className="text-xs text-[var(--color-text-secondary)]">上传 Excel 后可配置字段匹配并预览数据。</p>}
            </MySurface>

            <MySurface className="space-y-4 p-4">
              <div className="flex items-start gap-3">
                <Badge
                  color={
                    state.completed || state.importing ? "accent" : "default"
                  }
                  className="!static !translate-x-0 !translate-y-0"
                >
                  3
                </Badge>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    导入数据
                  </h3>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    确认映射后开始逐条写入。
                  </p>
                </div>
              </div>
              {state.importing || state.completed ? (
                <div className="text-center">
                  <div className="text-base font-semibold text-[var(--color-text-primary)]">
                    {state.completed ? "导入完成" : "正在导入数据"}
                  </div>
                  <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                    {state.completed
                      ? `成功 ${state.successCount} 条，失败 ${state.failureCount} 条`
                      : `正在逐条写入，共 ${new Set(state.rowGroups ?? state.rows.map((_, index) => index)).size} 条主记录`}
                  </p>
                  <ProgressBar
                    aria-label="导入进度"
                    value={state.progress}
                    className="mt-5"
                  >
                    <div className="flex justify-between">
                      <span>{state.successCount} 条成功</span>
                      <ProgressBar.Output>
                        {state.progress}%
                      </ProgressBar.Output>
                    </div>
                    <ProgressBar.Track>
                      <ProgressBar.Fill />
                    </ProgressBar.Track>
                  </ProgressBar>
                  {state.failureCount > 0 ? (
                    <p>有 {state.failureCount} 条数据导入失败。</p>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-[var(--color-text-secondary)]">
                  完成前两组设置后开始导入。
                </p>
              )}
            </MySurface>
          </Drawer.Body>
          <Drawer.Footer className="flex-wrap">
            {state.rows.length > 0 && missingRequiredLabels.length > 0 && !state.completed ? (
              <p role="alert" className="w-full text-xs text-[var(--color-danger)]">
                请为以下必填字段选择 Excel 导入列：{missingRequiredLabels.join("、")}。匹配完成后才能开始导入。
              </p>
            ) : null}
            <Button
              variant="ghost"
              isDisabled={state.importing}
              onPress={() => onOpenChange(false)}
            >
              关闭
            </Button>
            <Button
              isDisabled={
                state.importing ||
                state.loading ||
                state.completed ||
                missingRequiredIds.size > 0 ||
                !Object.values(state.mappings).some(Boolean) ||
                state.rows.length === 0
              }
              onPress={() => void onImport()}
            >
              {state.importing ? "导入中…" : "开始导入"}
            </Button>
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
