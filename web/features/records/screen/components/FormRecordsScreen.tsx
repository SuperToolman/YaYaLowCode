"use client";

import { useEffect, useState } from "react";

import { useSearchParams } from "next/navigation";

import { isSystemPageSlug } from "@/features/application/system-pages";
import { DefinedPageHome } from "@/features/records/screen/components/DefinedPageHome";

import { getForm } from "@/features/form-runtime/api";

import { FormHomeRecords } from "./FormHomeRecords";
export function FormRecordsScreen({
  appId,
  formUuid,
  embedded = false,
  readOnly = false,
  pageParameters,
}: {
  appId: string;
  formUuid: string;
  embedded?: boolean;
  readOnly?: boolean;
  pageParameters?: Record<string, string>;
}) {
  const routeQuery = useSearchParams();
  const pageReadOnly = readOnly || (embedded ? pageParameters?.buttonPageMode : routeQuery.get("buttonPageMode")) === "view";
  const [resolvedFormType, setResolvedFormType] = useState<
    "normal" | "workflow" | "defined" | "detail" | null
  >(() => (isSystemPageSlug(formUuid) ? "normal" : null));

  useEffect(() => {
    if (isSystemPageSlug(formUuid)) {
      return;
    }
    let cancelled = false;
    void getForm({
      path: { formUuid },
      responseStyle: "fields",
    })
      .then(({ data, error }) => {
        if (cancelled || error || data?.code !== 0 || !data.data) return;
        setResolvedFormType(
          data.data.formType === "defined"
            ? "defined"
            : data.data.formType === "workflow"
              ? "workflow"
              : data.data.formType === "detail"
                ? "detail"
                : "normal",
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [formUuid]);

  if (resolvedFormType === "defined") {
    return <DefinedPageHome appId={appId} formUuid={formUuid} embedded={embedded} />;
  }

  if (resolvedFormType === null && !isSystemPageSlug(formUuid)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-[var(--color-text-secondary)]">
        正在加载页面...
      </div>
    );
  }

  return <FormHomeRecords appId={appId} formUuid={formUuid} embedded={embedded} readOnly={pageReadOnly} pageParameters={pageParameters} />;
}
