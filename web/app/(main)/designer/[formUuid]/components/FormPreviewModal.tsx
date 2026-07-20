"use client";

import { Modal } from "@heroui/react/modal";
import type { FormDesignerSchema } from "../designer-schema";
import { useTheme } from "../../../../components/theme-provider";
import {
  RuntimeFormRenderer,
  type RuntimeDebugEvent,
  type RuntimeFormSchema,
} from "../../../../components/runtime-form-renderer";

type FormPreviewModalProps = {
  isOpen: boolean;
  schema: FormDesignerSchema;
  onDebugEvent?: (event: RuntimeDebugEvent) => void;
  onOpenChange: (isOpen: boolean) => void;
};

export function FormPreviewModal({
  isOpen,
  schema,
  onDebugEvent,
  onOpenChange,
}: FormPreviewModalProps) {
  const { resolvedTheme } = useTheme();
  const visibleFields = schema.fields.filter((field) => !field.props.isHidden);
  const runtimeSchema: RuntimeFormSchema = {
    ...schema,
    pageProps: schema.pageProps,
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop className="designer-modal-backdrop" isDismissable>
        <Modal.Container
          placement="center"
          scroll="inside"
          size="cover"
        >
          <Modal.Dialog
            data-theme={resolvedTheme}
            className="designer-theme-surface flex h-[90vh] w-[90vw] max-w-[90vw] flex-col overflow-hidden rounded-2xl bg-[var(--designer-surface-solid)] text-[var(--color-text-primary)] shadow-[var(--shadow-dialog)]"
          >
            <Modal.Header className="border-b border-[var(--designer-border)] bg-[var(--designer-surface-solid)] px-5 py-4">
              <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
                <div className="min-w-0">
                  <Modal.Heading className="mt-1 truncate text-xl font-semibold text-[var(--color-text-primary)]">
                    {schema.formName}
                  </Modal.Heading>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--color-primary-soft)] px-3 py-1 text-sm font-medium text-[var(--color-primary)]">
                  {visibleFields.length} 个控件
                </span>
                <Modal.CloseTrigger
                  aria-label="关闭预览"
                  className="shrink-0"
                />
              </div>
            </Modal.Header>

            <Modal.Body className="flex-1 overflow-auto bg-[var(--designer-surface-soft)] p-5">
              <div className="mx-auto min-h-full max-w-[1180px] rounded-2xl border border-[var(--designer-border)] bg-[var(--designer-surface-solid)] p-6 shadow-[var(--shadow-designer)]">
                {visibleFields.length > 0 ? (
                  <RuntimeFormRenderer
                    schema={runtimeSchema}
                    submitLabel={schema.pageProps?.submitButtonText?.trim() || "提交"}
                    showSubmitButton={false}
                    urlParams={{ preview: "true", formUuid: schema.formUuid }}
                    onDebugEvent={onDebugEvent}
                    onSubmit={async (values) => {
                      console.info("[preview-submit]", values);
                    }}
                  />
                ) : (
                  <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-[var(--designer-border)] bg-[var(--designer-surface-muted)] text-sm text-[var(--color-text-secondary)]">
                    当前没有可预览控件
                  </div>
                )}
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
