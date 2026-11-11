"use client";

import { memo } from "react";
import { RuntimeFormRenderer } from "@/features/form-runtime/components";
import type { RuntimeFormSchema } from "@/features/form-model/runtime-types";

export const RuntimeFormPanel = memo(function RuntimeFormPanel({
  formId,
  recordUuid,
  initialValues,
  isReadOnly,
  readOnlyDisplay,
  onValuesChange,
  schema,
  showSubmitButton,
  submitLabel,
  submitting,
  urlParams,
  valuePatch,
  onSubmit,
}: {
  formId?: string;
  recordUuid?: string;
  initialValues?: Record<string, unknown>;
  isReadOnly?: boolean;
  readOnlyDisplay?: boolean;
  onValuesChange?: (values: Record<string, unknown>) => void;
  schema: RuntimeFormSchema;
  showSubmitButton?: boolean;
  submitLabel: string;
  submitting: boolean;
  urlParams: Record<string, string>;
  valuePatch?: { id: number; values: Record<string, unknown> };
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <RuntimeFormRenderer
      initialValues={initialValues}
      formId={formId}
      recordUuid={recordUuid}
      isReadOnly={isReadOnly}
      readOnlyDisplay={readOnlyDisplay}
      runLoadActionInReadOnly={urlParams.buttonPageMode !== undefined}
      onValuesChange={onValuesChange}
      schema={schema}
      showSubmitButton={showSubmitButton}
      submitLabel={submitLabel}
      submitting={submitting}
      urlParams={urlParams}
      valuePatch={valuePatch}
      onSubmit={onSubmit}
    />
  );
});

