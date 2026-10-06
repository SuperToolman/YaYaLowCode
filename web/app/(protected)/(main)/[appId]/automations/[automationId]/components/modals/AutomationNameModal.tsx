"use client";

import { Button, Input } from "@heroui/react";
import { Modal } from "@heroui/react/modal";

type AutomationNameModalProps = {
  isOpen: boolean;
  name: string;
  description: string;
  error: string;
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
  error,
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
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable={!isSaving}>
        <Modal.Container placement="center" size="md">
          <Modal.Dialog className="theme-menu-surface">
            <Modal.Header>
              <Modal.Heading>编辑自动化名称</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭编辑名称" isDisabled={isSaving} />
            </Modal.Header>
            <Modal.Body className="space-y-4">
              <Input
                aria-label="自动化名称"
                placeholder="自动化名称"
                value={name}
                onChange={(event) => onNameChange(event.currentTarget.value)}
                disabled={isSaving}
              />
              <Input
                aria-label="自动化说明"
                placeholder="自动化说明"
                value={description}
                onChange={(event) =>
                  onDescriptionChange(event.currentTarget.value)
                }
                disabled={isSaving}
              />
              {error ? (
                <p role="alert" className="text-sm text-[var(--color-danger)]">
                  {error}
                </p>
              ) : null}
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
