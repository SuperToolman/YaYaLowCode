"use client";

import { Modal } from "@heroui/react/modal";
import type { FormDesignerSchema } from "../designer-schema";
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
  const visibleFields = schema.fields.filter((field) => !field.props.isHidden);
  const runtimeSchema: RuntimeFormSchema = {
    ...schema,
    pageProps: schema.pageProps,
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop className="bg-[#14213d]/20" isDismissable>
        <Modal.Container
          placement="center"
          scroll="inside"
          size="cover"
        >
          <Modal.Dialog className="flex h-[90vh] w-[90vw] max-w-[90vw] flex-col overflow-hidden rounded-2xl bg-white text-[#202f45] shadow-[0_30px_90px_rgba(20,33,61,0.24)]">
            <Modal.Header className="border-b border-[#eef2f7] px-5 py-4">
              <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7c8ca6]">
                    Preview
                  </p>
                  <Modal.Heading className="mt-1 truncate text-xl font-semibold text-[#14213d]">
                    {schema.formName}
                  </Modal.Heading>
                </div>
                <span className="shrink-0 rounded-full bg-[#edf4ff] px-3 py-1 text-sm font-medium text-[#2f6bff]">
                  {visibleFields.length} 个控件
                </span>
                <Modal.CloseTrigger
                  aria-label="关闭预览"
                  className="shrink-0"
                />
              </div>
            </Modal.Header>

            <Modal.Body className="flex-1 overflow-auto bg-[#f5f8fc] p-5">
              <div className="mx-auto min-h-full max-w-[1180px] rounded-2xl border border-[#dce7f5] bg-white p-6 shadow-[0_20px_70px_rgba(31,65,122,0.08)]">
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
                  <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-[#cbd8ea] bg-[#f7faff] text-sm text-[#7d8da8]">
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
