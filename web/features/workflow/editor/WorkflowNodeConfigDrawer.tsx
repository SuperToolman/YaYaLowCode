"use client";

import type { ReactNode } from "react";
import { Button } from "@heroui/react/button";
import { Description } from "@heroui/react/description";
import { Drawer } from "@heroui/react/drawer";
import { Tooltip } from "@heroui/react/tooltip";
import { TrashBin } from "@gravity-ui/icons";

type WorkflowNodeConfigDrawerProps = {
  children: ReactNode;
  onDelete?: () => void;
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
  onDelete,
  onOpenChange,
  subtitle,
  title,
}: WorkflowNodeConfigDrawerProps) {
  return (
    <Drawer isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Backdrop isDismissable>
        <Drawer.Content placement="right">
          <Drawer.Dialog style={{ width: 830, maxWidth: "85vw" }}>
            <Drawer.Header className="flex-row items-start justify-between">
              <div className="min-w-0 flex-1">
                <Drawer.Heading className="break-words">{title}</Drawer.Heading>
                <Description>{subtitle}</Description>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {headerActions}
                {onDelete ? (
                  <Tooltip>
                    <Tooltip.Trigger>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="danger-soft"
                        aria-label="删除节点"
                        onPress={onDelete}
                      >
                        <TrashBin />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>删除节点</Tooltip.Content>
                  </Tooltip>
                ) : null}
                <Drawer.CloseTrigger
                  aria-label="关闭属性配置"
                  className="static"
                />
              </div>
            </Drawer.Header>
            <Drawer.Body>
              <div className="space-y-2">{children}</div>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
