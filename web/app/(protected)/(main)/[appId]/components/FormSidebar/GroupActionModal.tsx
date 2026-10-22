"use client";

import { Button, Input, Label, Select, ListBox } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import { ROOT_PARENT_VALUE } from "./constants";
import type { useFormSidebar } from "./useFormSidebar";

type Props = Pick<
  ReturnType<typeof useFormSidebar>,
  | "selectedGroup"
  | "groupAction"
  | "closeGroupAction"
  | "groupActionPending"
  | "groupActionValue"
  | "setGroupActionValue"
  | "moveGroupOptions"
  | "handleGroupAction"
>;

export function GroupActionModal({
  selectedGroup,
  groupAction,
  closeGroupAction,
  groupActionPending,
  groupActionValue,
  setGroupActionValue,
  moveGroupOptions,
  handleGroupAction,
}: Props) {
  return (
    <Modal.Backdrop
      isOpen={Boolean(selectedGroup && groupAction)}
      onOpenChange={(open) => !open && closeGroupAction()}
      isDismissable={!groupActionPending}
    >
      <Modal.Container placement="center" size="md">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>
              {groupAction === "rename"
                ? "修改分组名称"
                : groupAction === "move"
                  ? "移动分组"
                  : "删除分组"}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="space-y-4">
            {groupAction === "rename" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="group-action-name">分组名称</Label>
                <Input
                  id="group-action-name"
                  value={groupActionValue}
                  disabled={groupActionPending}
                  onChange={(event) =>
                    setGroupActionValue(event.currentTarget.value)
                  }
                />
              </div>
            ) : null}
            {groupAction === "move" ? (
              <Select
                selectedKey={groupActionValue}
                isDisabled={groupActionPending}
                onSelectionChange={(key) =>
                  setGroupActionValue(String(key ?? ROOT_PARENT_VALUE))
                }
              >
                <Label>移动到</Label>
                <Select.Trigger>
                  <Select.Value>
                    {groupActionValue === ROOT_PARENT_VALUE
                      ? "顶级"
                      : (moveGroupOptions.find(
                          (item) => item.id === groupActionValue,
                        )?.label ?? "顶级")}
                  </Select.Value>
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id={ROOT_PARENT_VALUE} textValue="顶级">
                      顶级
                    </ListBox.Item>
                    {moveGroupOptions.map((item) => (
                      <ListBox.Item
                        key={item.id}
                        id={item.id}
                        textValue={item.label}
                      >
                        {item.label}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            ) : null}
            {groupAction === "delete" ? (
              <p className="m-0 text-sm text-muted">
                确定删除分组“{selectedGroup?.title}
                ”吗？分组内的表单和子分组不会被删除，它们会自动上移到当前分组的父级。
              </p>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button
              onPress={closeGroupAction}
              isDisabled={groupActionPending}
            >
              取消
            </Button>
            <Button
              onPress={handleGroupAction}
              isDisabled={
                groupActionPending ||
                (groupAction === "rename" && !groupActionValue.trim())
              }
            >
              {groupAction === "delete" ? "删除" : "确定"}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
