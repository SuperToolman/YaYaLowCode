"use client";
import { notifyRequestError } from "@/shared/lib/notify";
import { useEffect, useRef, useState } from "react";
import { Button, Drawer } from "@heroui/react";
import { RuntimeFormRenderer } from "@/features/form-runtime/components/RuntimeFormRenderer";
import type { RuntimeFormSchema } from "@/features/form-model/runtime-types";
import { fetchCurrentFormSchema } from "@/features/form-runtime/api";
import { resolveButtonFill, submitButton } from "@/features/custom-buttons/api";
import { writableFields, type ButtonDefinition } from "@/features/custom-buttons/model";
import { notify } from "@/shared/lib/notify";
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
  button, sourceFormUuid, viewUuid, recordId, onClose, onSaved,
}: {
  button: ButtonDefinition;
  sourceFormUuid: string;
  viewUuid: string;
  recordId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [schema, setSchema] = useState<RuntimeFormSchema | null>(null);
  const [resolved, setResolved] = useState<Awaited<ReturnType<typeof resolveButtonFill>> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selection, setSelection] = useState<{ page: number; id?: string; revision: number }>({ page: 1, revision: 0 });
  const requestRef = useRef<{ id: string; pending: boolean }>({ id: "", pending: false });
  const sameForm = button.actionConfig.targetFormUuid === sourceFormUuid;
  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchCurrentFormSchema(button.actionConfig.targetFormUuid),
      resolveButtonFill(sourceFormUuid, viewUuid, button.id, recordId, selection.page, selection.id),
    ]).then(([schema, result]) => {
      if (!active) return;
      setSchema(sameForm ? selectButtonFields(schema, button.actionConfig.fieldIds) : schema);
      setResolved(result);
      setLoading(false);
      setError("");
      requestRef.current = { id: crypto.randomUUID(), pending: false };
    }).catch((error: unknown) => {
      if (!active) return;
      setLoading(false);
      setError(error instanceof Error ? error.message : "加载填写表单失败");
    });
    return () => { active = false; };
  }, [button, sourceFormUuid, viewUuid, recordId, sameForm, selection]);
  function reload(page = 1, id?: string) {
    setLoading(true);
    setResolved(null);
    setError("");
    setSelection(current => ({ page, id, revision: current.revision + 1 }));
  }
  return (
    <Drawer isOpen onOpenChange={open => { if (!open && !submitting) onClose(); }}>
      <Drawer.Backdrop isDismissable={!submitting}>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="w-[min(860px,100vw)]">
            <Drawer.Header>
              <Drawer.Heading>{button.name} · {button.targetFormName || "填写表单"}</Drawer.Heading>
              <Drawer.CloseTrigger isDisabled={submitting} />
            </Drawer.Header>
            <Drawer.Body>
              {loading ? <p role="status">正在查找填写实例…</p> : null}
              {error ? <div className="flex flex-col items-start gap-4"><p role="alert">{error}</p><Button variant="secondary" onPress={() => reload()}>重新加载</Button></div> : null}
              {!loading && !error && resolved?.operation === "select" ? (
                <div className="flex flex-col gap-4">
                  <p>找到 {resolved.total} 条关联实例，请选择要编辑的实例。</p>
                  {resolved.candidates.map(record => <Button key={record.id} variant="secondary" className="h-auto justify-start whitespace-normal py-3 text-left" onPress={() => reload(1, record.id)}>
                    <span>{String(record.data && typeof record.data === "object" && !Array.isArray(record.data) ? Object.fromEntries(Object.entries(record.data)).instanceTitle || record.id : record.id)} · {record.createdBy} · {record.createdAt}</span>
                  </Button>)}
                  <div className="flex items-center justify-end gap-3">
                    <Button variant="secondary" isDisabled={resolved.page <= 1} onPress={() => reload(resolved.page - 1)}>上一页</Button>
                    <span>第 {resolved.page} 页</span>
                    <Button variant="secondary" isDisabled={resolved.page * resolved.pageSize >= resolved.total} onPress={() => reload(resolved.page + 1)}>下一页</Button>
                  </div>
                </div>
              ) : null}
              {!loading && !error && schema && resolved && resolved.operation !== "select" ? (
                <>
                  <p role="status" className="mb-4 text-sm text-[var(--color-text-secondary)]">{resolved.operation === "update" ? "编辑已有实例" : "未找到关联实例，将新建；已带入可确定的条件默认值。"}</p>
                  <RuntimeFormRenderer
                    key={`${resolved.operation}:${resolved.targetRecord?.id ?? "new"}:${selection.revision}`}
                    schema={schema}
                    initialValues={resolved.initialValues && typeof resolved.initialValues === "object" && !Array.isArray(resolved.initialValues) ? Object.fromEntries(Object.entries(resolved.initialValues)) : {}}
                    recordUuid={resolved.targetRecord?.id}
                    showSubmitButton
                    submitLabel={resolved.operation === "update" ? "保存" : "提交"}
                    submitting={submitting}
                    urlParams={{ appId: button.actionConfig.targetAppId, formUuid: button.actionConfig.targetFormUuid }}
                    onSubmit={async values => {
                      if (requestRef.current.pending) return;
                      requestRef.current.pending = true;
                      setSubmitting(true);
                      const allowed = new Set(sameForm ? button.actionConfig.fieldIds : writableFields(schema.fields).map(field => field.id));
                      try {
                        await submitButton(sourceFormUuid, viewUuid, button.id, {
                          recordId, operation: resolved.operation, targetRecordId: resolved.targetRecord?.id,
                          requestId: requestRef.current.id, configurationVersion: resolved.configurationVersion,
                          data: Object.fromEntries(Object.entries(values).filter(([id]) => allowed.has(id))),
                        });
                        notify.success(resolved.operation === "update" ? "实例已更新" : "目标表单实例已创建");
                        onSaved?.();
                        onClose();
                      } catch (error) {
                        notifyRequestError(error, error instanceof Error ? error.message : "保存失败");
                        // Keep the request ID for retries after an uncertain network result.
                      } finally { requestRef.current.pending = false; setSubmitting(false); }
                    }}
                  />
                  <Button className="mt-4" variant="secondary" isDisabled={submitting} onPress={() => reload()}>重新查找实例</Button>
                </>
              ) : null}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
