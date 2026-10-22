"use client";
import { notifyRequestError } from "@lib/notify";
import { useEffect, useState } from "react";
import { Drawer } from "@heroui/react";
import {
  RuntimeFormRenderer,
  type RuntimeFormSchema,
} from "@/features/form-runtime/components/RuntimeFormRenderer";
import { fetchCurrentFormSchema } from "@/features/form-runtime/api";
import { submitButton } from "@/features/custom-buttons/api";
import type { ButtonDefinition } from "@/features/custom-buttons/model";
import { notify } from "@lib/notify";
export function selectButtonFields(
  schema: RuntimeFormSchema,
  fieldIds: string[],
): RuntimeFormSchema {
  const selected = new Set(fieldIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const field of schema.fields) {
      if (
        selected.has(field.id) &&
        field.parentGroupId &&
        !selected.has(field.parentGroupId)
      ) {
        selected.add(field.parentGroupId);
        changed = true;
      }
      if (
        field.parentGroupId &&
        selected.has(field.parentGroupId) &&
        schema.fields.some(
          (parent) =>
            parent.id === field.parentGroupId && parent.type === "subform",
        ) &&
        !selected.has(field.id)
      ) {
        selected.add(field.id);
        changed = true;
      }
    }
  }
  return {
    ...schema,
    fields: schema.fields.filter((field) => selected.has(field.id)),
  };
}
export function CustomButtonFillDrawer({
  button,
  sourceFormUuid,
  viewUuid,
  recordId,
  onClose,
}: {
  button: ButtonDefinition;
  sourceFormUuid: string;
  viewUuid: string;
  recordId: string;
  onClose: () => void;
}) {
  const [schema, setSchema] = useState<RuntimeFormSchema | null>(null);
  const [failed, setFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    let active = true;
    fetchCurrentFormSchema(button.actionConfig.targetFormUuid)
      .then((schema) => {
        if (active)
          setSchema(selectButtonFields(schema, button.actionConfig.fieldIds));
      })
      .catch((e) => {
        if (active) {
          setFailed(true);
          notifyRequestError(e, e.message || "加载填写表单失败");
        }
      });
    return () => {
      active = false;
    };
  }, [button]);
  return (
    <Drawer
      isOpen
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <Drawer.Backdrop isDismissable={!submitting}>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="w-[min(860px,100vw)]">
            <Drawer.Header>
              <Drawer.Heading>
                {button.name} · {button.targetFormName || "填写表单"}
              </Drawer.Heading>
              <Drawer.CloseTrigger isDisabled={submitting} />
            </Drawer.Header>
            <Drawer.Body>
              {!schema && !failed ? <p>正在加载填写表单…</p> : null}
              {schema ? (
                <RuntimeFormRenderer
                  schema={schema}
                  showSubmitButton
                  submitLabel="提交"
                  submitting={submitting}
                  urlParams={{
                    appId: button.actionConfig.targetAppId,
                    formUuid: button.actionConfig.targetFormUuid,
                  }}
                  onSubmit={async (values) => {
                    setSubmitting(true);
                    try {
                      await submitButton(
                        sourceFormUuid,
                        viewUuid,
                        button.id,
                        recordId,
                        Object.fromEntries(
                          Object.entries(values).filter(([id]) =>
                            button.actionConfig.fieldIds.includes(id),
                          ),
                        ),
                      );
                      notify.success("目标表单记录已创建");
                      onClose();
                    } catch (e) {
                      notifyRequestError(e, e instanceof Error ? e.message : "提交失败");
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                />
              ) : null}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
