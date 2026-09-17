import { COLUMN_COUNT } from "./designer-constants";
import { getRowCount, normalizeRichTextLayouts } from "./designer-layout";
import { getDefaultDesignerFieldProps } from "./components/CompTool";
import type { PageDesignerProps, PlacedField } from "./designer-types";
import {
  getDefaultActionPanelCode,
  normalizeActionPanelCode,
} from "@lib/action-panel-code";

export function getDefaultPageDesignerProps(): PageDesignerProps {
  return {
    formulaValidations: [
      { id: "formula-dictionary-exists", label: "EXIST(字典项)" },
      { id: "formula-sequence-exists", label: "EXIST(序号)" },
    ],
    serviceValidations: [],
    customServiceValidations: [],
    stopRulesOnFailure: false,
    businessFailureRules: [],
    integrationAutomations: [{ id: "integration-1", label: "集成&自动化" }],
    serviceExecutions: [],
    customServiceExecutions: [],
    submitButtonText: "提交",
    beforeSubmitActions: [],
    afterSubmitActions: [],
    afterDataInitActions: [],
    dataSourceCode: "",
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
    agent: {
      enabled: false,
      agentId: "",
      prompt: "",
    },
  };
}

export function normalizePageDesignerProps(
  pageProps?: Partial<PageDesignerProps> | null,
): PageDesignerProps {
  const defaults = getDefaultPageDesignerProps();
  const agent = {
    ...defaults.agent,
    ...pageProps?.agent,
  };

  return {
    ...defaults,
    ...pageProps,
    formulaValidations: pageProps?.formulaValidations ?? defaults.formulaValidations,
    serviceValidations: pageProps?.serviceValidations ?? defaults.serviceValidations,
    customServiceValidations:
      pageProps?.customServiceValidations ?? defaults.customServiceValidations,
    businessFailureRules: pageProps?.businessFailureRules ?? defaults.businessFailureRules,
    integrationAutomations:
      pageProps?.integrationAutomations ?? defaults.integrationAutomations,
    serviceExecutions: pageProps?.serviceExecutions ?? defaults.serviceExecutions,
    customServiceExecutions:
      pageProps?.customServiceExecutions ?? defaults.customServiceExecutions,
    beforeSubmitActions: pageProps?.beforeSubmitActions ?? defaults.beforeSubmitActions,
    afterSubmitActions: pageProps?.afterSubmitActions ?? defaults.afterSubmitActions,
    afterDataInitActions: pageProps?.afterDataInitActions ?? defaults.afterDataInitActions,
    dataSources: pageProps?.dataSources ?? defaults.dataSources,
    assets: pageProps?.assets ?? defaults.assets,
    indexedFieldIds: pageProps?.indexedFieldIds ?? defaults.indexedFieldIds,
    actionPanel: {
      ...defaults.actionPanel,
      ...pageProps?.actionPanel,
      code: normalizeActionPanelCode(pageProps?.actionPanel),
    },
    // Historical schemas may contain enabled=true without an employee binding.
    // Treat those records as the explicit "Agent disabled" option.
    agent: { ...agent, enabled: Boolean(agent.enabled && agent.agentId) },
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
        props: {
          ...getDefaultDesignerFieldProps(field.type),
          ...(field.props ?? {}),
        },
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
    pageProps,
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
        props: field.props,
      })),
  };
}

export type FormDesignerSchema = ReturnType<typeof buildSchema>;
