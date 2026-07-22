"use client";

import type { ReactNode } from "react";
import { Drawer } from "@heroui/react/drawer";

type WorkflowNodeConfigDrawerProps = {
  children: ReactNode;
  headerActions?: ReactNode;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  subtitle: string;
  title: string;
};

export function WorkflowNodeConfigDrawer({
  children,
  headerActions,
  isOpen,
  onOpenChange,
  subtitle,
  title,
}: WorkflowNodeConfigDrawerProps) {
  return (
    <Drawer isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Backdrop isDismissable>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="automation-property-panel w-[430px] max-w-[85vw] overflow-hidden p-0">
            <Drawer.Header className="border-b border-[var(--color-border)] bg-[var(--color-control-soft)] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Drawer.Heading className="automation-property-title font-semibold text-[var(--color-text-primary)]">
                    {title}
                  </Drawer.Heading>
                  <p className="mt-0.5 text-[var(--color-text-secondary)]">
                    {subtitle}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {headerActions}
                  <Drawer.CloseTrigger
                    aria-label="关闭属性配置"
                    className="flex h-8 min-w-8 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2 text-[var(--color-text-secondary)]"
                  >
                    ×
                  </Drawer.CloseTrigger>
                </div>
              </div>
            </Drawer.Header>
            <Drawer.Body className="min-h-0 flex-1 overflow-y-auto p-2">
              <div className="space-y-2">{children}</div>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
