"use client";

import type { ChangeEvent, KeyboardEvent } from "react";
import { Button, Dropdown, Input } from "@heroui/react";
import { Card } from "@heroui/react/card";
import { ArrowLeftIcon, RestoreIcon } from "../../../../components/app-icons";
import { COLUMN_COUNT } from "../designer-constants";

export type FormVersionSummary = {
  version: number;
  published: boolean;
  isCurrentDraft: boolean;
  isCurrentPublished: boolean;
  changeLog?: string | null;
  createdAt: string;
};

type FormDesignerHeaderProps = {
  appId?: string | null;
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
  saveMessage?: string;
};

export function FormDesignerHeader({
  appId,
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
  saveMessage,
}: FormDesignerHeaderProps) {
  return (
    <Card className="mb-5 shrink-0 border border-[#dce7f5] bg-white/90 p-5 shadow-[0_20px_70px_rgba(31,65,122,0.08)] backdrop-blur">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                className="h-9 rounded-xl bg-transparent px-3 text-[#35507b]"
                onPress={onBackToApp}
              >
                <ArrowLeftIcon />
                {appId ? `返回应用 ${appId}` : "返回应用"}
              </Button>
              <span className="rounded-full bg-[#f3f7ff] px-3 py-1 text-xs font-medium text-[#35507b]">
                FORM {formUuid}
              </span>
              <span className="rounded-full bg-[#edf4ff] px-3 py-1 text-xs font-medium text-[#2f6bff]">
                草稿 v{latestVersion} / 发布 v{publishedVersion}
              </span>
              <span className="rounded-full bg-[#f7fbff] px-3 py-1 text-xs font-medium text-[#60718a]">
                {rowCount} x {COLUMN_COUNT} 网格 / 控件数：{fieldsCount}
              </span>
            </div>
            {isEditingFormName ? (
              <Input
                aria-label="表单名称"
                autoFocus
                className="mt-3 max-w-[420px]"
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
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <h1
                  className="cursor-text text-2xl font-semibold text-[#14213d]"
                  title="双击编辑表单名称"
                  onDoubleClick={() => onEditingFormNameChange(true)}
                >
                  {formName.trim() || "New Page"}
                </h1>
                <span className="rounded-full bg-[#f5f8fc] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#7c8ca6]">
                  Form Designer
                </span>
              </div>
            )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
            {saveMessage ? (
              <span className="mr-1 text-sm text-[#65748f]">{saveMessage}</span>
            ) : null}
            <Dropdown>
              <Dropdown.Trigger>
                <span
                  aria-label="恢复历史版本"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#dce7f5] bg-white text-[#35507b] transition hover:bg-[#f7faff]"
                >
                  <RestoreIcon />
                </span>
              </Dropdown.Trigger>
              <Dropdown.Popover>
                <Dropdown.Menu
                  aria-label="恢复历史版本"
                  disabledKeys={versions.length === 0 ? ["empty"] : []}
                  onAction={(key) => {
                    const version = Number(String(key));

                    if (!Number.isNaN(version)) {
                      onRestoreVersionSelect(version);
                    }
                  }}
                >
                  {versions.length > 0 ? (
                    versions.map((item) => (
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
              className="bg-[#edf4ff] text-[#2f6bff]"
              onPress={onPreview}
            >
              预览
            </Button>
            <Button
              className="bg-[#eaf7ef] text-[#18794e]"
              onPress={onPublish}
            >
              发布
            </Button>
            <Button className="bg-[#2f6bff] text-white" onPress={onSave}>
              保存
            </Button>
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
