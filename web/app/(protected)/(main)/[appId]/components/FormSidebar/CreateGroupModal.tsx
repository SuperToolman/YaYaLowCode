"use client";

import { Button, Input, Label, Select, ListBox } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import { ROOT_PARENT_VALUE } from "./constants";
import type { useFormSidebar } from "./useFormSidebar";

type Props = Pick<
  ReturnType<typeof useFormSidebar>,
  | "createGroupOpen"
  | "setCreateGroupOpen"
  | "groupName"
  | "setGroupName"
  | "groupParentId"
  | "setGroupParentId"
  | "groupOptions"
  | "handleCreateGroup"
  | "isPending"
>;

export function CreateGroupModal({
  createGroupOpen,
  setCreateGroupOpen,
  groupName,
  setGroupName,
  groupParentId,
  setGroupParentId,
  groupOptions,
  handleCreateGroup,
  isPending,
}: Props) {
  return (
    <Modal.Backdrop
      isOpen={createGroupOpen}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setCreateGroupOpen(false);
        }
      }}
      isDismissable
    >
      <Modal.Container placement="center" size="md">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>创建分组</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="space-y-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="create-group-name">分组名称</Label>
              <Input
                id="create-group-name"
                placeholder="请输入分组名称"
                value={groupName}
                onChange={(event) => setGroupName(event.currentTarget.value)}
              />
            </div>
            <Select
              selectedKey={groupParentId}
              onSelectionChange={(key) =>
                setGroupParentId(String(key ?? ROOT_PARENT_VALUE))
              }
            >
              <Label>上级分组</Label>
              <Select.Trigger>
                <Select.Value>
                  {groupParentId === ROOT_PARENT_VALUE
                    ? "顶级分组"
                    : (groupOptions.find((item) => item.id === groupParentId)
                        ?.label ?? "顶级分组")}
                </Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id={ROOT_PARENT_VALUE} textValue="顶级分组">
                    顶级分组
                  </ListBox.Item>
                  {groupOptions.map((item) => (
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
          </Modal.Body>
          <Modal.Footer>
            <Button onPress={() => setCreateGroupOpen(false)}>取消</Button>
            <Button
              onPress={handleCreateGroup}
              isDisabled={isPending || !groupName.trim()}
            >
              创建
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
