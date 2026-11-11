"use client";

import { Button, Input, Label, TextField } from "@heroui/react";
import { Modal } from "@heroui/react/modal";

type AutomationNameModalProps = {
  isOpen: boolean;
  name: string;
  description: string;
  isSaving: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSubmit: () => void;
};

export function AutomationNameModal({
  isOpen,
  name,
  description,
  isSaving,
  onOpenChange,
  onNameChange,
  onDescriptionChange,
  onSubmit,
}: AutomationNameModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && isSaving) return;
        onOpenChange(open);
      }}
    >
      <Modal.Backdrop
        className="theme-modal-backdrop"
        isDismissable={!isSaving}
      >
        <Modal.Container placement="center" size="md">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>编辑自动化名称</Modal.Heading>
              <Modal.CloseTrigger
                aria-label="关闭编辑名称"
                isDisabled={isSaving}
              />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <TextField
                className="flex flex-col gap-2"
                value={name}
                onChange={onNameChange}
                isDisabled={isSaving}
                isRequired
              >
                <Label>自动化名称</Label>
                <Input placeholder="请输入自动化名称" />
              </TextField>
              <TextField
                className="flex flex-col gap-2"
                value={description}
                onChange={onDescriptionChange}
                isDisabled={isSaving}
              >
                <Label>自动化说明</Label>
                <Input placeholder="请输入自动化说明" />
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button
                variant="secondary"
                isDisabled={isSaving}
                onPress={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button
                variant="primary"
                isDisabled={isSaving || !name.trim()}
                onPress={onSubmit}
              >
                {isSaving ? "提交中..." : "确定"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
