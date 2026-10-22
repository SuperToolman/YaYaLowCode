"use client";

import { memo } from "react";
import {
  RuntimeFormRenderer,
  type RuntimeFormSchema,
} from "@/features/form-runtime/components";

export const RuntimeFormPanel = memo(function RuntimeFormPanel({
  formId,
  recordUuid,
  initialValues,
  isReadOnly,
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

