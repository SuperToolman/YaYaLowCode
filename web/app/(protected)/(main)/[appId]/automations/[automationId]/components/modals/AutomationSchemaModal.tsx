"use client";

import { Modal } from "@heroui/react/modal";

type AutomationSchemaModalProps = {
  isOpen: boolean;
  schema: string;
  onOpenChange: (isOpen: boolean) => void;
};

export function AutomationSchemaModal({
  isOpen,
  schema,
  onOpenChange,
}: AutomationSchemaModalProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" size="cover">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>自动化 Schema</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭 Schema 查看器" />
            </Modal.Header>
            <Modal.Body className="min-h-0 flex-1 overflow-hidden">
              <textarea
                readOnly
                aria-label="自动化 Schema"
                className="h-full min-h-0 w-full resize-none bg-[var(--color-code-bg)] font-mono text-xs leading-6 text-[var(--color-code-text)] outline-none"
                value={schema}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
