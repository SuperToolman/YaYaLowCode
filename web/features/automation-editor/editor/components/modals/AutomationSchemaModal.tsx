"use client";

import { Modal } from "@heroui/react/modal";
import { MonacoEditor } from "@/shared/ui/MonacoEditor";

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
              <MonacoEditor
                height="100%"
                language="json"
                value={schema}
                options={{
                  readOnly: true,
                  domReadOnly: true,
                  ariaLabel: "自动化 Schema",
                }}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
