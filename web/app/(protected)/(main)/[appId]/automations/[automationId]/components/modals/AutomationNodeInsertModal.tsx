"use client";

import { Modal } from "@heroui/react/modal";
import { Plus as AddIcon } from "@gravity-ui/icons";
import {
  placeholderNodeGroups,
  type NodeMenuItem,
  type PaletteNodeKind,
} from "../../automation-editor-model";

type NodeMenuGroup = { group: string; items: NodeMenuItem[] };

type AutomationNodeInsertModalProps = {
  isOpen: boolean;
  groups: NodeMenuGroup[];
  nodeTone: Record<PaletteNodeKind, string>;
  onOpenChange: (isOpen: boolean) => void;
  onSelect: (kind: PaletteNodeKind) => void;
};

export function AutomationNodeInsertModal({
  isOpen,
  groups,
  nodeTone,
  onOpenChange,
  onSelect,
}: AutomationNodeInsertModalProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" size="cover">
          <Modal.Dialog
            data-node-insert-modal="true"
            className="w-[min(720px,92vw)] rounded-2xl bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]"
          >
            <Modal.Header className="border-b border-[var(--color-border)]">
              <Modal.Heading className="text-lg font-semibold text-[var(--color-text-primary)]">
                选择要插入的节点
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="max-h-[72vh] space-y-5 overflow-auto">
              {groups.map((group) => (
                <section key={group.group}>
                  <div className="mb-3 text-sm font-medium text-[var(--color-text-secondary)]">
                    {group.group}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {group.items.map((item) => (
                      <button
                        key={item.kind}
                        type="button"
                        onClick={() => onSelect(item.kind)}
                        className="flex min-h-[72px] items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-control-soft)] px-4 py-3 text-left transition hover:border-[var(--color-primary)] hover:bg-[var(--color-control-soft-hover)]"
                      >
                        <span
                          className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${nodeTone[item.kind]}`}
                        >
                          <AddIcon />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
                            {item.label}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-[var(--color-text-secondary)]">
                            {item.description}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {placeholderNodeGroups.map((group) => (
                <section key={group.group}>
                  <div className="mb-3 text-sm font-medium text-[var(--color-text-secondary)]">
                    {group.group}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {group.items.map((item) => (
                      <div
                        key={item}
                        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-control-soft)] px-4 py-3 text-sm text-[var(--color-text-disabled)]"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
