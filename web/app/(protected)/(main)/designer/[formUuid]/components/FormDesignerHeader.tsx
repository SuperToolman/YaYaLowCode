"use client";

import type { ChangeEvent, KeyboardEvent } from "react";
import { Button, ButtonGroup, Card, Dropdown, Input } from "@heroui/react";
import { ArrowLeft as ArrowLeftIcon, Eye as PreviewIcon, ClockArrowRotateLeft as VersionIcon, FloppyDisk as SaveIcon } from "@gravity-ui/icons";

export type FormVersionSummary = {
  version: number;
  componentCount?: number;
  changeLog?: string | null;
  createdAt: string;
};

type FormDesignerHeaderProps = {
  appName?: string | null;
  formName: string;
  formUuid: string;
  currentVersion: number;
  isEditingFormName: boolean;
  versions: FormVersionSummary[];
  onBackToApp: () => void;
  onEditingFormNameChange: (isEditing: boolean) => void;
  onFormNameChange: (formName: string) => void;
  onPreview: () => void;
  onRestoreVersionSelect: (version: number) => void;
  onSave: () => void;
  onWorkflowDesign?: () => void;
  canEditForm: boolean;
  saveMessage?: string;
};

export function FormDesignerHeader({
  appName,
  formName,
  formUuid,
  currentVersion,
  isEditingFormName,
  versions,
  onBackToApp,
  onEditingFormNameChange,
  onFormNameChange,
  onPreview,
  onRestoreVersionSelect,
  onSave,
  onWorkflowDesign,
  canEditForm,
  saveMessage,
}: FormDesignerHeaderProps) {
  const displayedVersions = versions.slice(0, 20);

  return (
    <Card className="mb-2 shrink-0 overflow-hidden p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                className="h-9 shrink-0 px-2 text-[var(--color-text-secondary)]"
                onPress={onBackToApp}
              >
                <ArrowLeftIcon />
                {appName ? `返回应用 ${appName}` : "返回应用"}
              </Button>
          </div>
          <div className="min-w-0 flex-1">
            {isEditingFormName ? (
              <Input
                aria-label="表单名称"
                autoFocus
                className="max-w-xl"
                value={formName}
                onBlur={() => onEditingFormNameChange(false)}
                onChange={(event: ChangeEvent<HTMLInputElement>) => onFormNameChange(event.currentTarget.value)}
                onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => handleFormNameKeyDown(event, onEditingFormNameChange)}
              />
            ) : (
              <h1
                className="min-w-0 cursor-text truncate text-xl font-semibold text-[var(--color-text-primary)]"
                title="双击编辑表单名称"
                onDoubleClick={() => onEditingFormNameChange(true)}
              >
                {formName.trim() || "New Page"}
              </h1>
            )}
            <p className="mt-1 break-all font-mono text-xs text-[var(--color-text-secondary)]" title={formUuid}>{formUuid}</p>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2 whitespace-nowrap">
            {onWorkflowDesign ? (
              <Button variant="secondary" onPress={onWorkflowDesign}>流程设计</Button>
            ) : null}
            {saveMessage ? (
              <span className="mr-1 text-sm text-[var(--color-text-secondary)]">{saveMessage}</span>
            ) : null}
            <ButtonGroup aria-label="表单操作">
              <Dropdown>
              <Dropdown.Trigger
                aria-label="读取历史版本"
                className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-hover)]"
              >
                <VersionIcon />
                版本
              </Dropdown.Trigger>
              <Dropdown.Popover>
                <Dropdown.Menu
                  aria-label="读取历史版本"
                  className="max-h-[min(70vh,32rem)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto p-1"
                  disabledKeys={displayedVersions.length === 0 ? ["empty"] : []}
                  onAction={(key) => {
                    const version = Number(String(key));

                    if (!Number.isNaN(version)) {
                      onRestoreVersionSelect(version);
                    }
                  }}
                >
                  {displayedVersions.length > 0 ? (
                    displayedVersions.map((item) => (
                      <Dropdown.Item
                        key={String(item.version)}
                        id={String(item.version)}
                        textValue={`v${item.version}`}
                        className="min-h-0 items-stretch px-3 py-2.5"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <div className="flex min-w-0 items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="shrink-0 text-sm font-semibold text-[var(--color-text-primary)]">v{item.version}</span>
                              {item.version === currentVersion ? (
                                <span className="rounded-sm bg-[var(--color-primary-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-primary)]">当前</span>
                              ) : null}
                            </div>
                            <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">
                              {item.componentCount === undefined ? "组件数未知" : `${item.componentCount} 个组件`}
                            </span>
                          </div>
                          <p className="truncate text-xs text-[var(--color-text-secondary)]" title={item.changeLog || "初始版本"}>
                            {item.changeLog || "初始版本"}
                          </p>
                          <time className="text-[11px] tabular-nums text-[var(--color-text-tertiary)]" dateTime={item.createdAt}>
                            {formatVersionCreatedAt(item.createdAt)}
                          </time>
                        </div>
                      </Dropdown.Item>
                    ))
                  ) : (
                    <Dropdown.Item id="empty">暂无可恢复版本</Dropdown.Item>
                  )}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <Button variant="secondary" onPress={onPreview}>
              <PreviewIcon />
              预览
            </Button>
            {canEditForm ? <Button variant="primary" onPress={onSave}>
              <SaveIcon />
              保存
            </Button> : null}
            </ButtonGroup>
          </div>
      </div>
    </Card>
  );
}

function formatVersionCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "创建时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}

function handleFormNameKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  setIsEditing: (value: boolean) => void,
) {
  if (event.key === "Enter") {
    event.currentTarget.blur();
  }

  if (event.key === "Escape") {
    setIsEditing(false);
  }
}
