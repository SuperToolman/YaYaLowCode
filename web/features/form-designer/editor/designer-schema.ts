import { COLUMN_COUNT } from "./designer-constants";
import { getRowCount, normalizeRichTextLayouts } from "./designer-layout";
import { cleanDesignerFieldProps, getDefaultDesignerFieldProps } from "./components/CompTool";
import type { PageDesignerProps, PlacedField } from "./designer-types";
import { getDefaultActionPanelCode, normalizeActionPanelCode } from "@/features/form-model/action-panel-code";

const RETIRED_PAGE_PROP_KEYS = [
  "formulaValidations",
  "serviceValidations",
  "customServiceValidations",
  "stopRulesOnFailure",
  "businessFailureRules",
  "integrationAutomations",
  "serviceExecutions",
  "customServiceExecutions",
  "beforeSubmitActions",
  "afterSubmitActions",
  "afterDataInitActions",
  "dataSourceCode",
  "agent"
] as const;

function cleanPageDesignerProps(pageProps?: Partial<PageDesignerProps> | null) {
  const cleaned = { ...pageProps } as Partial<PageDesignerProps> & Record<string, unknown>;
  for (const key of RETIRED_PAGE_PROP_KEYS) delete cleaned[key];
  return cleaned;
}

export function getDefaultPageDesignerProps(): PageDesignerProps {
  return {
    submitButtonText: "提交",
    dataSources: [
      {
        id: "ds-current-user",
        name: "currentUser",
        kind: "object",
        initialValue: '{"id":"","name":""}',
        description: "当前登录用户",
      },
    ],
    assets: [],
    indexedFieldIds: [],
    actionPanel: {
      code: getDefaultActionPanelCode(),
    },
  };
}

export function normalizePageDesignerProps(
  pageProps?: Partial<PageDesignerProps> | null,
): PageDesignerProps {
  const defaults = getDefaultPageDesignerProps();

  return {
    ...defaults,
    ...cleanPageDesignerProps(pageProps),
    dataSources: pageProps?.dataSources ?? defaults.dataSources,
    assets: pageProps?.assets ?? defaults.assets,
    indexedFieldIds: pageProps?.indexedFieldIds ?? defaults.indexedFieldIds,
    actionPanel: {
      ...defaults.actionPanel,
      ...pageProps?.actionPanel,
      code: normalizeActionPanelCode(pageProps?.actionPanel),
    },
  };
}

/** Restores defaults for fields persisted by older schema versions. */
export function normalizeDesignerFields(fields?: PlacedField[] | null): PlacedField[] {
  return normalizeRichTextLayouts(
    (fields ?? [])
      .filter((field): field is PlacedField => Boolean(field))
      .map((field) => ({
        ...field,
        parentGroupId: field.parentGroupId ?? null,
        props: cleanDesignerFieldProps({
          ...getDefaultDesignerFieldProps(field.type),
          ...(field.props ?? {}),
          ...(field.type === "serialNumber" ? { isRequired: true } : {}),
        }),
      })),
  );
}

export function buildSchema(
  formUuid: string,
  formName: string,
  fields: PlacedField[],
  pageProps: PageDesignerProps,
) {
  const normalizedFields = normalizeRichTextLayouts(fields);
  return {
    formUuid,
    formName: formName.trim() || "New Page",
    columns: COLUMN_COUNT,
    rows: getRowCount(normalizedFields),
    pageProps: cleanPageDesignerProps(pageProps) as PageDesignerProps,
    fields: [...normalizedFields]
      .sort((left, right) => left.row - right.row || left.column - right.column)
      .map((field) => ({
        id: field.id,
        type: field.type,
        label: field.label,
        row: field.row,
        column: field.column,
        rowSpan: field.rowSpan,
        colSpan: field.colSpan,
        parentGroupId: field.parentGroupId ?? null,
        props: cleanDesignerFieldProps(field.type === "serialNumber" ? { ...field.props, isRequired: true } : field.props),
      })),
  };
}

export type FormDesignerSchema = ReturnType<typeof buildSchema>;
