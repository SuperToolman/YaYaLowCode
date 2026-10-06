"use client";

import { Button } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import { MySurface } from "@/components/ui/MySurface";
import type { ApiAutomationFlowVersionSummary } from "@/features/automation-editor/api";

type AutomationVersionsModalProps = {
  isOpen: boolean;
  currentVersion?: number;
  status: "enabled" | "paused";
  createdAt?: string;
  updatedAt?: string;
  versions: ApiAutomationFlowVersionSummary[];
  isLoading: boolean;
  restoringVersion: number | null;
  formatDate: (value?: string) => string;
  onOpenChange: (isOpen: boolean) => void;
  onRestore: (version: number) => void;
};

export function AutomationVersionsModal({
  isOpen,
  currentVersion,
  status,
  createdAt,
  updatedAt,
  versions,
  isLoading,
  restoringVersion,
  formatDate,
  onOpenChange,
  onRestore,
}: AutomationVersionsModalProps) {
  const activeVersion = currentVersion ?? 1;

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" size="cover">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>版本管理</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-2">
              <MySurface className="p-2">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                  当前版本
                </div>
                <div className="mt-2 text-sm text-[var(--color-text-primary)]">
                  v{activeVersion}
                </div>
                <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  当前状态：{status === "enabled" ? "启动" : "停止"}
                </div>
                <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  最新保存时间：{formatDate(updatedAt)}
                </div>
                <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  创建时间：{formatDate(createdAt)}
                </div>
              </MySurface>
              <MySurface className="p-2">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                  历史版本
                </div>
                {isLoading ? (
                  <div className="mt-3 text-sm text-[var(--color-text-secondary)]">
                    正在加载版本...
                  </div>
                ) : versions.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {versions.map((item) => (
                      <div
                        key={item.version}
                        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-canvas)] px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[var(--color-text-primary)]">
                              {`v${item.version} · ${item.name}`}
                            </div>
                            <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                              保存时：{item.status === "enabled" ? "启动" : "停止"}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 text-[var(--color-text-primary)] disabled:opacity-50"
                            isDisabled={
                              restoringVersion === item.version ||
                              item.version === activeVersion
                            }
                            onClick={() => onRestore(item.version)}
                          >
                            {item.version === activeVersion
                              ? "当前版本"
                              : restoringVersion === item.version
                                ? "切换中"
                                : "切换"}
                          </Button>
                        </div>
                        <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                          {`${item.createdBy} · ${formatDate(item.createdAt)}`}
                        </div>
                        {item.changeSummary ? (
                          <div className="mt-2 text-sm text-[var(--color-text-primary)]">
                            {item.changeSummary}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-[var(--color-text-secondary)]">
                    暂无版本记录
                  </div>
                )}
              </MySurface>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
