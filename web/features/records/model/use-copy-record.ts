"use client";
import { notifyRequestError } from "@lib/notify";

import { useCallback, useRef, useState } from "react";
import type { RuntimeFormSchema } from "@/features/form-runtime/components/runtime-form-types";
import { notify } from "@lib/notify";
import { useRecordMutations } from "../mutations";
import type { FormRecord } from "../types";

export function useCopyRecord(formUuid: string, schema: RuntimeFormSchema, canCreateRecord: boolean, isDetailForm = false) {
  const { create } = useRecordMutations(formUuid);
  const { mutateAsync } = create;
  const pending = useRef(false);
  const [copyingRecordId, setCopyingRecordId] = useState<string | null>(null);

  const copyRecord = useCallback(async (record: FormRecord) => {
    if (!canCreateRecord || pending.current) return;
    pending.current = true;
    setCopyingRecordId(record.id);
    try {
      // Use the full schema, including fields hidden by the current table view.
      // Record identity, audit metadata and workflow state belong to the new instance.
      const values = structuredClone(Object.fromEntries(
        schema.fields
          .filter((field) => Object.hasOwn(record.data, field.id))
          .map((field) => [field.id, record.data[field.id]]),
      ));
      if (isDetailForm) {
        values.__parentRecordUuid = record.id.slice(0, record.id.lastIndexOf(":"));
      }
      await mutateAsync(values);
      notify.success("记录已复制，已创建新实例");
    } catch (error) {
      notifyRequestError(error, "复制记录失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      pending.current = false;
      setCopyingRecordId(null);
    }
  }, [canCreateRecord, isDetailForm, mutateAsync, schema]);

  return { copyRecord, copyingRecordId };
}
