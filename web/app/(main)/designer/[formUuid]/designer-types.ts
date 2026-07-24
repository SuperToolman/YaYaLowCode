import type {
  DesignerComponentType,
  DesignerFieldProps,
} from "./components/CompTool";

export type FormDesignerProps = {
  params: Promise<{ formUuid: string }>;
};

export type PlacedField = {
  id: string;
  type: DesignerComponentType;
  label: string;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  props: DesignerFieldProps;
  parentGroupId?: string | null;
};

export type ActiveCell = {
  row: number;
  column: number;
};

export type DesignerDragData =
  | {
      kind: "component";
      componentType: DesignerComponentType;
    }
  | {
      kind: "field";
      fieldId: string;
    };

export type DesignerDropData = {
  kind: "cell";
  row: number;
  column: number;
  parentGroupId: string | null;
  insertionDirection?:
    | "before-row"
    | "after-row"
    | "before-column"
    | "after-column";
  targetFieldId?: string;
  allowRowInsertion?: boolean;
};

export type DesignerInsertionIndicator = {
  kind: "edge";
  fieldId: string;
  direction: NonNullable<DesignerDropData["insertionDirection"]>;
};

export type ResizeDirection = "columns" | "rows" | "both";

export type ResizeState = {
  fieldId: string;
  startX: number;
  startY: number;
  startRowSpan: number;
  startColSpan: number;
  direction: ResizeDirection;
};

export type FieldPropsChangeHandler = (
  fieldId: string,
  props: DesignerFieldProps,
) => void;

export type PageNamedRule = {
  id: string;
  label: string;
};

export type DesignerDataSource = {
  id: string;
  name: string;
  kind: "string" | "number" | "boolean" | "object";
  initialValue: string;
  description?: string;
};

export type DesignerPageAsset = {
  id: string;
  name: string;
  type: "script" | "style";
  url: string;
  integrity?: string;
  enabled: boolean;
};

export type DesignerFieldAction = {
  id: string;
  fieldId: string;
  eventName: string;
  script: string;
};

export type DesignerActionPanelState = {
  code: string;
  didMount?: string;
  onSubmit?: string;
  fieldEvents?: DesignerFieldAction[];
};

export type DesignerAgentConfig = {
  enabled: boolean;
  agentId: string;
  prompt: string;
  context: {
    generated: string;
    overrides: string;
    generatedAt: string;
    sourceHash: string;
    status: "idle" | "analyzing" | "ready" | "stale" | "failed";
    error: string;
  };
};

export type PageDesignerProps = {
  formulaValidations: PageNamedRule[];
  serviceValidations: PageNamedRule[];
  customServiceValidations: PageNamedRule[];
  stopRulesOnFailure: boolean;
  businessFailureRules: PageNamedRule[];
  integrationAutomations: PageNamedRule[];
  serviceExecutions: PageNamedRule[];
  customServiceExecutions: PageNamedRule[];
  submitButtonText: string;
  beforeSubmitActions: PageNamedRule[];
  afterSubmitActions: PageNamedRule[];
  afterDataInitActions: PageNamedRule[];
  dataSourceCode: string;
  dataSources: DesignerDataSource[];
  assets: DesignerPageAsset[];
  indexedFieldIds: string[];
  actionPanel: DesignerActionPanelState;
  agent: DesignerAgentConfig;
};
