"use client";

import { unwrapApiResult } from "@/app/lib/api-request";
import { submitWorkflowRecord, reverseWorkflowRecord, pauseWorkflowRecord, resumeWorkflowRecord, completeWorkflowExecution } from "@lib/http";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createDetailFormData, createRecord, deleteFormData, deleteRecord, postWorkflowComment, updateRecord } from "./api";

export function runWorkflowRecordAction(
  formUuid: string,
  recordUuid: string,
  action: string,
  comment: string,
  signal?: AbortSignal,
) {
  const options = { path: { formUuid, recordUuid }, signal };
  const result = action === "pause" ? pauseWorkflowRecord({ ...options, body: { reason: comment } })
    : action === "submit" ? submitWorkflowRecord(options)
    : action === "reverse" ? reverseWorkflowRecord(options)
    : action === "resume" ? resumeWorkflowRecord(options) : undefined;
  if (!result) throw new Error("未知流程操作");
  return result.then(response => unwrapApiResult(response));
}

export function completeWorkflowExecutionTask(taskUuid: string, changes: Record<string, unknown>) {
  return completeWorkflowExecution({ path: { taskUuid }, body: { data: changes } }).then(result => unwrapApiResult(result));
}

export function useRecordMutations(formUuid: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["form-records", formUuid] });
  return {
    create: useMutation({ mutationFn: (values: Record<string, unknown>) => createRecord(formUuid, values), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ recordUuid, values }: { recordUuid: string; values: Record<string, unknown> }) => updateRecord(formUuid, recordUuid, values), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (recordUuid: string) => deleteRecord(formUuid, recordUuid), onSuccess: refresh }),
    removeForm: useMutation({ mutationFn: () => deleteFormData(formUuid) }),
    createDetailForm: useMutation({ mutationFn: (body: { subformFieldId: string; primaryDisplayFieldId?: string; secondaryDisplayFieldId?: string }) => createDetailFormData(formUuid, body) }),
  };
}

export function usePostWorkflowComment(formUuid: string, recordUuid: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => postWorkflowComment(formUuid, recordUuid, content),
    onSuccess: (comment) => queryClient.setQueryData(
      ["workflow-comments", formUuid, recordUuid],
      (current: unknown[] = []) => [...current, comment],
    ),
  });
}
