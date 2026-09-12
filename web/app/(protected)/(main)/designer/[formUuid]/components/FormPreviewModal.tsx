"use client";

import { Drawer } from "@heroui/react/drawer";
import type { FormDesignerSchema } from "../designer-schema";
import { useTheme } from "../../../../../components/ThemeProvider";
import {
  RuntimeFormRenderer,
  RuntimeFormSurface,
  type RuntimeDebugEvent,
  type RuntimeFormSchema,
} from "../../../../../components/RuntimeFormRenderer";

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
    <Drawer isOpen={isOpen} onOpenChange={onOpenChange}>
      <Drawer.Backdrop className="designer-modal-backdrop" isDismissable>
        <Drawer.Content placement="right">
          <Drawer.Dialog
            data-theme={resolvedTheme}
            className="w-[90vw]"
          >
            <Drawer.Header>
              <div className="flex justify-between">
                <div className="min-w-0">
                  <Drawer.Heading>
                    {schema.formName}
                  </Drawer.Heading>
                </div>
                <span className="shrink-0 mr-5 rounded-full bg-[var(--color-primary-soft)] px-3 py-1 text-sm font-medium text-[var(--color-primary)]">
                  {visibleFields.length} 个控件
                </span>
                <Drawer.CloseTrigger
                  aria-label="关闭预览"
                  className="shrink-0"
                />
              </div>
            </Drawer.Header>

            <Drawer.Body>
              <RuntimeFormSurface>
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
                  <div>
                    当前没有可预览控件
                  </div>
                )}
              </RuntimeFormSurface>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
