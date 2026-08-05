"use client";

import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { getAssociationFormData, getDetailForms, getFormBootstrapData, getRecordsPage, getWorkflowActions, getWorkflowComments } from "./api";
import type { RecordFilter, RecordSort } from "./types";

export function useFormBootstrapQuery(appId: string, formUuid: string, enabled: boolean) {
  return useQuery({
    queryKey: ["form-bootstrap", appId, formUuid],
    enabled,
    queryFn: () => getFormBootstrapData(appId, formUuid),
    staleTime: 60_000,
  });
}

export function useAssociationFormsQuery(formUuids: string[]) {
  const results = useQueries({
    queries: formUuids.map((formUuid) => ({
      queryKey: ["association-form", formUuid],
      queryFn: () => getAssociationFormData(formUuid),
      staleTime: 60_000,
    })),
  });
  return new Map(results.flatMap((result, index) => result.data ? [[formUuids[index], result.data] as const] : []));
}

export function useWorkflowActionsQuery(formUuid: string, recordUuid: string) {
  return useQuery({
    queryKey: ["workflow-actions", formUuid, recordUuid],
    queryFn: ({ signal }) => getWorkflowActions(formUuid, recordUuid, signal),
  });
}

export function useWorkflowCommentsQuery(formUuid: string, recordUuid: string) {
  return useQuery({
    queryKey: ["workflow-comments", formUuid, recordUuid],
    queryFn: ({ signal }) => getWorkflowComments(formUuid, recordUuid, signal),
  });
}

export function useDetailFormsQuery(formUuid: string, enabled: boolean) {
  return useQuery({
    queryKey: ["detail-forms", formUuid],
    queryFn: () => getDetailForms(formUuid),
    enabled,
    staleTime: 60_000,
  });
}

export function useParentRecordsQuery(formUuid?: string) {
  return useQuery({
    queryKey: ["parent-records", formUuid],
    queryFn: () => getRecordsPage({ formUuid: formUuid!, page: 1, pageSize: 100, filters: [], sorts: [], detail: true }),
    enabled: Boolean(formUuid),
    staleTime: 60_000,
  });
}

export function useRecordsQuery(input: {
  formUuid: string;
  page: number;
  pageSize: number;
  filters: RecordFilter[];
  sorts: RecordSort[];
  detail: boolean;
  enabled: boolean;
  initialData?: { items: unknown[]; total: number; page: number; pageSize: number };
}) {
  return useQuery({
    queryKey: ["form-records", input.formUuid, input.page, input.pageSize, input.filters, input.sorts],
    enabled: input.enabled,
    queryFn: () => getRecordsPage(input),
    initialData: input.initialData,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
