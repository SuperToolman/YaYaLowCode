import { COLUMN_COUNT } from "./designer-constants";
import { getRowCount } from "./designer-layout";
import type { PageDesignerProps, PlacedField } from "./designer-types";
import {
  getDefaultActionPanelCode,
  normalizeActionPanelCode,
} from "../../../lib/action-panel-code";

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
    actionPanel: {
      code: getDefaultActionPanelCode(),
    },
    agent: {
      enabled: false,
      agentId: "",
      prompt: "",
      context: {
        generated: "",
        overrides: "",
        generatedAt: "",
        sourceHash: "",
        status: "idle",
        error: "",
      },
    },
  };
}

export function normalizePageDesignerProps(
  pageProps?: Partial<PageDesignerProps> | null,
): PageDesignerProps {
  const defaults = getDefaultPageDesignerProps();

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
    actionPanel: {
      ...defaults.actionPanel,
      ...pageProps?.actionPanel,
      code: normalizeActionPanelCode(pageProps?.actionPanel),
    },
    agent: {
      ...defaults.agent,
      ...pageProps?.agent,
      context: {
        ...defaults.agent.context,
        ...pageProps?.agent?.context,
      },
    },
  };
}

export function buildSchema(
  formUuid: string,
  formName: string,
  fields: PlacedField[],
  pageProps: PageDesignerProps,
) {
  return {
    formUuid,
    formName: formName.trim() || "New Page",
    columns: COLUMN_COUNT,
    rows: getRowCount(fields),
    pageProps,
    fields: [...fields]
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
