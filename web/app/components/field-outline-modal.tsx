"use client";

import { Modal } from "@heroui/react";
import { FieldOutlinePage } from "../(protected)/(main)/designer/field-outline-page";

type FieldOutlineModalProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
};

export function FieldOutlineModal({ isOpen, onOpenChange }: FieldOutlineModalProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" size="cover">
          <Modal.Dialog className="h-[min(92dvh,960px)] w-[min(1180px,96vw)] overflow-hidden rounded-xl bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]">
            <Modal.Header className="border-b border-[var(--color-border)] px-5 py-3">
              <Modal.Heading className="sr-only">字段大纲</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭字段大纲" />
            </Modal.Header>
            <Modal.Body className="min-h-0 flex-1 overflow-hidden p-0">
              <FieldOutlinePage />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
