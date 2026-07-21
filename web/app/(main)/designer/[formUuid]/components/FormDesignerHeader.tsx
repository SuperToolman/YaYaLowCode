"use client";

import type { ChangeEvent, KeyboardEvent } from "react";
import { Button, Dropdown, Input } from "@heroui/react";
import { Card } from "@heroui/react/card";
import {
  ArrowLeftIcon,
  PreviewIcon,
  PublishIcon,
  RestoreIcon,
  SaveIcon,
} from "../../../../components/app-icons";
import { COLUMN_COUNT } from "../designer-constants";
import { CompactThemeSwitcher } from "../../../../components/theme-switcher-menu";

export type FormVersionSummary = {
  version: number;
  published: boolean;
  isCurrentDraft: boolean;
  isCurrentPublished: boolean;
  changeLog?: string | null;
  createdAt: string;
};

const designerViews = [
  "表单设计",
  "流程设计",
  "页面设置",
  "页面发布",
  "数据管理",
] as const;

type FormDesignerHeaderProps = {
  appName?: string | null;
  fieldsCount: number;
  formName: string;
  formUuid: string;
  isEditingFormName: boolean;
  latestVersion: number;
  publishedVersion: number;
  rowCount: number;
  versions: FormVersionSummary[];
  onBackToApp: () => void;
  onEditingFormNameChange: (isEditing: boolean) => void;
  onFormNameChange: (formName: string) => void;
  onPreview: () => void;
  onPublish: () => void;
  onRestoreVersionSelect: (version: number) => void;
  onSave: () => void;
  canEditForm: boolean;
  canPublish: boolean;
  saveMessage?: string;
};

export function FormDesignerHeader({
  appName,
  fieldsCount,
  formName,
  formUuid,
  isEditingFormName,
  latestVersion,
  publishedVersion,
  rowCount,
  versions,
  onBackToApp,
  onEditingFormNameChange,
  onFormNameChange,
  onPreview,
  onPublish,
  onRestoreVersionSelect,
  onSave,
  canEditForm,
  canPublish,
  saveMessage,
}: FormDesignerHeaderProps) {
  const displayedVersions = versions.slice(0, 20);

  return (
    <Card className="mb-2 shrink-0 border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5 shadow-[var(--shadow-designer)] backdrop-blur">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                className="h-9 rounded-xl bg-transparent px-3 text-[var(--color-text-secondary)]"
                onPress={onBackToApp}
              >
                <ArrowLeftIcon />
                {appName ? `返回应用 ${appName}` : "返回应用"}
              </Button>
              <span className="rounded-full bg-[var(--color-primary-soft)] px-3 py-1 text-xs font-medium text-[var(--color-primary)]">
                草稿 v{latestVersion} / 发布 v{publishedVersion}
              </span>
              <span className="rounded-full bg-[var(--color-bg-subtle)] px-3 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
                {rowCount} x {COLUMN_COUNT} 网格 / 控件数：{fieldsCount}
              </span>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 whitespace-nowrap">
            <CompactThemeSwitcher />
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
                        {`v${item.version}${
                          item.isCurrentDraft ? " · 草稿" : ""
                        }${item.isCurrentPublished ? " · 已发布" : ""}`}
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
            {canPublish ? <Button
              className="bg-[var(--color-success-soft)] text-[var(--color-success)]"
              onPress={onPublish}
            >
              <PublishIcon />
              发布
            </Button> : null}
            {canEditForm ? <Button className="bg-[var(--color-primary)] text-[var(--color-text-on-primary)]" onPress={onSave}>
              <SaveIcon />
              保存
            </Button> : null}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-3">
          {isEditingFormName ? (
            <Input
              aria-label="表单名称"
              autoFocus
              className="max-w-[360px]"
              value={formName}
              onBlur={() => onEditingFormNameChange(false)}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                onFormNameChange(event.currentTarget.value)
              }
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) =>
                handleFormNameKeyDown(event, onEditingFormNameChange)
              }
            />
          ) : (
            <h1
              className="max-w-[300px] truncate cursor-text text-2xl font-semibold text-[var(--color-text-primary)]"
              title="双击编辑表单名称"
              onDoubleClick={() => onEditingFormNameChange(true)}
            >
              {formName.trim() || "New Page"}
            </h1>
          )}
          <span className="shrink-0 rounded-full bg-[var(--color-bg-subtle)] px-3 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
            FORM {formUuid}
          </span>
          <nav
            className="ml-auto flex shrink-0 items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel-soft)] p-1"
            aria-label="表单设计器视图"
          >
            {designerViews.map((view, index) => (
              <button
                key={view}
                type="button"
                className={[
                  "h-8 rounded-lg px-3 text-xs transition-colors",
                  index === 0
                    ? "bg-[var(--color-primary)] font-medium text-[var(--color-text-on-primary)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]",
                ].join(" ")}
              >
                {view}
              </button>
            ))}
          </nav>
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
