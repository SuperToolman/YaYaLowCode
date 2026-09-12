"use client";

import type { ChangeEvent, KeyboardEvent } from "react";
import { Button, Card, Dropdown, Input, Tabs } from "@heroui/react";
import { ArrowLeft as ArrowLeftIcon, Eye as PreviewIcon, ArrowRotateLeft as RestoreIcon, FloppyDisk as SaveIcon } from "@gravity-ui/icons";

export type FormVersionSummary = {
  version: number;
  changeLog?: string | null;
  createdAt: string;
};

const normalDesignerViews = [
  "表单设计",
  "页面设置",
  "数据管理",
] as const;

type FormDesignerHeaderProps = {
  appName?: string | null;
  formName: string;
  formType: "normal" | "workflow" | "defined";
  formUuid: string;
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
  formType,
  formUuid,
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
  const designerViews = formType === "workflow"
    ? ["表单设计", "流程设计", ...normalDesignerViews.slice(1)]
    : formType === "defined"
      ? ["页面设计", "页面设置"]
    : normalDesignerViews;

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
          <Tabs
            className="ml-auto shrink-0"
            aria-label="表单设计器视图"
            selectedKey="designer"
            onSelectionChange={(key) => {
              if (String(key) === "workflow") onWorkflowDesign?.();
            }}
          >
            <Tabs.List>
              {designerViews.map((view, index) => {
                const isWorkflow = view === "流程设计";
                const id = isWorkflow ? "workflow" : index === 0 ? "designer" : `view-${index}`;
                return <Tabs.Tab key={id} id={id} isDisabled={index !== 0 && !isWorkflow}>{view}<Tabs.Indicator /></Tabs.Tab>;
              })}
            </Tabs.List>
          </Tabs>
          <div className="flex shrink-0 items-center justify-end gap-2 whitespace-nowrap">
            {saveMessage ? (
              <span className="mr-1 text-sm text-[var(--color-text-secondary)]">{saveMessage}</span>
            ) : null}
            <Dropdown>
              <Dropdown.Trigger
                aria-label="读取历史版本"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-subtle)]"
              >
                <RestoreIcon />
              </Dropdown.Trigger>
              <Dropdown.Popover>
                <Dropdown.Menu
                  aria-label="读取历史版本"
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
                      >
                        {`v${item.version}`}
                      </Dropdown.Item>
                    ))
                  ) : (
                    <Dropdown.Item id="empty">暂无可恢复版本</Dropdown.Item>
                  )}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <Button
              className="bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
              onPress={onPreview}
            >
              <PreviewIcon />
              预览
            </Button>
            {canEditForm ? <Button className="bg-[var(--color-primary)] text-[var(--color-text-on-primary)]" onPress={onSave}>
              <SaveIcon />
              保存
            </Button> : null}
          </div>
      </div>
    </Card>
  );
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
