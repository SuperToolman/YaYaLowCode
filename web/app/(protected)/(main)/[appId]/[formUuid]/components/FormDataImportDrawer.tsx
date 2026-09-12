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
} from "@heroui/react";
import { MySurface } from "@/app/components/my-fields/MySurface";

export type ImportWorkbookState = {
  fileName: string;
  headers: string[];
  rows: unknown[][];
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
};

type FormDataImportDrawerProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  state: ImportWorkbookState;
  setState: Dispatch<SetStateAction<ImportWorkbookState>>;
  fields: readonly ImportField[];
  builtinFieldLabels: ReadonlySet<string>;
  onDownloadTemplate: () => void | Promise<void>;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
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
}: FormDataImportDrawerProps) {
  return (
    <Drawer isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Backdrop className="theme-modal-backdrop" isDismissable={false}>
        <Drawer.Content placement="right" className="!justify-end">
          <Drawer.Dialog className="flex h-[100dvh] w-[min(720px,100vw)] flex-col overflow-hidden">
            <Drawer.Header className="border-b border-[var(--color-border)]">
              <div>
                <Drawer.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                  导入表单数据
                </Drawer.Heading>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                  按分组完成上传、字段匹配和导入。
                </p>
              </div>
              <Drawer.CloseTrigger aria-label="关闭导入" isDisabled={state.importing} />
            </Drawer.Header>
            <Drawer.Body className="space-y-6">
              <MySurface className="space-y-4 p-4">
                <div className="flex items-start gap-3">
                  <Badge color="accent" className="!static !translate-x-0 !translate-y-0">1</Badge>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">上传 Excel</h3>
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">下载模板并上传填写后的文件。</p>
                  </div>
                </div>
                <Button variant="secondary" onPress={() => void onDownloadTemplate()}>
                  <ArrowDownToLine className="h-4 w-4" />
                  下载 Excel 模板
                </Button>
                <Input
                  key={state.fileName || "empty-import-file"}
                  fullWidth
                  type="file"
                  accept=".xlsx,.xls"
                  aria-label="上传导入 Excel"
                  onChange={onFileChange}
                />
                {state.fileName ? (
                  <div className="rounded-lg border border-[var(--color-success)] bg-[var(--color-success-soft)] px-3 py-2 text-xs text-[var(--color-success)]">
                    已读取 {state.fileName}，共 {state.rows.length} 条数据、{state.headers.length} 列
                  </div>
                ) : null}
              </MySurface>

              <MySurface className={`space-y-4 p-4 ${state.rows.length === 0 ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-3">
                  <Badge color={state.rows.length ? "accent" : "default"} className="!static !translate-x-0 !translate-y-0">2</Badge>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">匹配导入字段</h3>
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">选择 Excel 列写入的表单字段，不需要的列可忽略。</p>
                  </div>
                </div>
                {state.rows.length ? (
                  <div className="space-y-3">
                    {state.headers.map((header, columnIndex) => (
                      <div key={`${header}-${columnIndex}`} className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)] items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-[var(--color-text-primary)]">{header || `未命名列 ${columnIndex + 1}`}</div>
                          {builtinFieldLabels.has(header) ? <div className="mt-0.5 text-[10px] text-[var(--color-text-secondary)]">系统字段，导入时自动生成</div> : null}
                        </div>
                        <span className="text-center text-[var(--color-text-disabled)]">→</span>
                        <Select
                          aria-label={`匹配 ${header || `第 ${columnIndex + 1} 列`}`}
                          isDisabled={builtinFieldLabels.has(header)}
                          selectedKey={state.mappings[columnIndex] || "__ignore__"}
                          onSelectionChange={(key) => setState((current) => ({
                            ...current,
                            mappings: {
                              ...current.mappings,
                              [columnIndex]: key === "__ignore__" || key === null ? "" : String(key),
                            },
                          }))}
                        >
                          <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              <ListBox.Item id="__ignore__" textValue="忽略此列">忽略此列</ListBox.Item>
                              {fields.map((field) => <ListBox.Item key={field.id} id={field.id} textValue={field.label}>{field.label}</ListBox.Item>)}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-[var(--color-text-secondary)]">上传 Excel 后可配置字段匹配。</p>}
              </MySurface>

              <MySurface className="space-y-4 p-4">
                <div className="flex items-start gap-3">
                  <Badge color={state.completed || state.importing ? "accent" : "default"} className="!static !translate-x-0 !translate-y-0">3</Badge>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">导入数据</h3>
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">确认映射后开始逐条写入。</p>
                  </div>
                </div>
                {state.importing || state.completed ? (
                  <div className="text-center">
                    <div className="text-base font-semibold text-[var(--color-text-primary)]">{state.completed ? "导入完成" : "正在导入数据"}</div>
                    <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                      {state.completed ? `成功 ${state.successCount} 条，失败 ${state.failureCount} 条` : `正在逐条写入，共 ${state.rows.length} 条数据`}
                    </p>
                    <ProgressBar aria-label="导入进度" value={state.progress} className="mt-5">
                      <div className="flex justify-between"><span>{state.successCount} 条成功</span><ProgressBar.Output>{state.progress}%</ProgressBar.Output></div>
                      <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
                    </ProgressBar>
                    {state.failureCount > 0 ? <p>有 {state.failureCount} 条数据导入失败。</p> : null}
                  </div>
                ) : <p className="text-xs text-[var(--color-text-secondary)]">完成前两组设置后开始导入。</p>}
              </MySurface>
            </Drawer.Body>
            <Drawer.Footer>
              <Button variant="ghost" isDisabled={state.importing} onPress={() => onOpenChange(false)}>关闭</Button>
              <Button
                isDisabled={state.importing || state.completed || !Object.values(state.mappings).some(Boolean) || state.rows.length === 0}
                onPress={() => void onImport()}
              >
                {state.importing ? "导入中…" : "开始导入"}
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
