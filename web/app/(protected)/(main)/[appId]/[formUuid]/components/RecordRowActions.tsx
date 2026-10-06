"use client";

import type { ReactNode } from "react";
import { Button, ButtonGroup, Dropdown } from "@heroui/react";
import {
  ArrowUturnCcwLeft,
  CirclePause,
  CirclePlay,
  Copy,
  Ellipsis,
  Eye,
  PaperPlane,
  TrashBin,
} from "@gravity-ui/icons";
import type { FormRecord } from "@/features/records/types";
import styles from "./RecordsTable.module.css";

type RecordAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  isDisabled?: boolean;
  tone?: "default" | "primary" | "warning" | "danger";
  onAction: () => void;
};

function RecordActionOverflowMenu({
  actions,
  __button_group_child: _buttonGroupChild,
}: {
  actions: RecordAction[];
  /** Consumed so ButtonGroup can safely use this component as a direct child. */
  __button_group_child?: boolean;
}) {
  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label="更多记录操作"
        className="button button--icon-only button--sm button--tertiary !inline-flex !items-center !justify-center !self-stretch"
      >
        <ButtonGroup.Separator />
        <Ellipsis className="h-4 w-4" />
      </Dropdown.Trigger>
      <Dropdown.Popover>
        <Dropdown.Menu aria-label="更多记录操作">
          {actions.map((action) => (
            <Dropdown.Item
              key={action.id}
              id={action.id}
              isDisabled={action.isDisabled}
              className={
                action.tone === "danger"
                  ? "text-[var(--color-danger)]"
                  : undefined
              }
              onAction={action.onAction}
            >
              <span className="flex items-center gap-2">
                {action.icon}
                {action.label}
              </span>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export function RecordRowActions({
  record,
  formType,
  submitting,
  canDeleteRecord,
  deletingRecordId,
  onOpenDetail,
  onWorkflowAction,
  onPause,
  onDelete,
  onCopy,
}: {
  record: FormRecord;
  formType: "normal" | "workflow";
  submitting: boolean;
  canDeleteRecord: boolean;
  deletingRecordId: string | null;
  onOpenDetail: () => void;
  onWorkflowAction: (action: "submit" | "reverse" | "resume") => void;
  onPause: () => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const actions: RecordAction[] = [
    {
      id: "view",
      label: "查看",
      icon: <Eye className="h-3.5 w-3.5" />,
      onAction: onOpenDetail,
    },
  ];

  if (formType === "workflow") {
    actions.push(
      {
        id: "submit",
        label: "提交",
        icon: <PaperPlane className="h-3.5 w-3.5" />,
        tone: "primary",
        isDisabled:
          submitting || record.data.workflowApprovalStatus !== "saved",
        onAction: () => onWorkflowAction("submit"),
      },
      {
        id: "reverse",
        label: "反审",
        icon: <ArrowUturnCcwLeft className="h-3.5 w-3.5" />,
        tone: "warning",
        isDisabled:
          submitting || record.data.workflowApprovalStatus !== "approved",
        onAction: () => onWorkflowAction("reverse"),
      },
      {
        id: "pause",
        label: "暂停",
        icon: <CirclePause className="h-3.5 w-3.5" />,
        isDisabled:
          submitting || record.data.workflowInstanceStatus !== "running",
        onAction: onPause,
      },
      {
        id: "resume",
        label: "恢复",
        icon: <CirclePlay className="h-3.5 w-3.5" />,
        tone: "primary",
        isDisabled:
          submitting || record.data.workflowInstanceStatus !== "paused",
        onAction: () => onWorkflowAction("resume"),
      },
    );
  }

  if (canDeleteRecord) {
    actions.push({
      id: "delete",
      label: deletingRecordId === record.id ? "删除中..." : "删除",
      icon: <TrashBin className="h-3.5 w-3.5" />,
      tone: "danger",
      isDisabled: deletingRecordId === record.id,
      onAction: onDelete,
    });
  }
  actions.push({
    id: "copy",
    label: "复制记录数据",
    icon: <Copy className="h-3.5 w-3.5" />,
    onAction: onCopy,
  });

  const directActions = actions.length >= 3 ? actions.slice(0, 2) : actions;
  const overflowActions = actions.length >= 3 ? actions.slice(2) : [];
  const toneClass = {
    default: undefined,
    primary: "text-[var(--color-primary)]",
    warning: "text-[var(--color-warning)]",
    danger: "text-[var(--color-danger)]",
  } as const;

  return (
    <div className={styles["records-table__row-actions"]}>
      <ButtonGroup size="sm" variant="tertiary">
        {directActions.map((action, index) => (
          <Button
            key={action.id}
            type="button"
            isDisabled={action.isDisabled}
            className={toneClass[action.tone ?? "default"]}
            onPress={action.onAction}
          >
            {index > 0 ? <ButtonGroup.Separator /> : null}
            {action.icon}
            {action.label}
          </Button>
        ))}
        {overflowActions.length > 0 ? (
          <RecordActionOverflowMenu actions={overflowActions} />
        ) : null}
      </ButtonGroup>
    </div>
  );
}
