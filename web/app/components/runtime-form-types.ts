import type { CountryCityValue } from "../lib/location-catalog";

export type RuntimeFieldType =
  | "groupContainer"
  | "subform"
  | "serialNumber"
  | "associationFormField"
  | "singleLineText"
  | "description"
  | "multiLineText"
  | "richText"
  | "html"
  | "tsx"
  | "number"
  | "radio"
  | "checkbox"
  | "select"
  | "multiSelect"
  | "link"
  | "date"
  | "dateRange"
  | "attachment"
  | "imageUpload"
  | "member"
  | "department"
  | "countryCity"
  | "cascader"
  | "button";

export type RuntimeFieldOption = {
  label: string;
  value: string;
};

export type RuntimeFieldProps = {
  titlePosition?: "top" | "left" | "inside";
  placeholder?: string;
  description?: string;
  defaultValueType?: "none" | "custom" | "formula" | "linkage";
  defaultValue?: string | number | string[] | CountryCityValue;
  defaultValueFormula?: string;
  defaultValueLinkage?: string;
  isDisabled?: boolean;
  isHidden?: boolean;
  isReadOnly?: boolean;
  isRequired?: boolean;
  showClearButton?: boolean;
  showCounter?: boolean;
  minValue?: number;
  maxValue?: number;
  step?: number;
  rows?: number;
  options?: RuntimeFieldOption[];
  orientation?: "horizontal" | "vertical";
  href?: string;
  target?: "_self" | "_blank";
  buttonText?: string;
  accept?: string;
  multiple?: boolean;
  maxFileSizeMb?: number;
  subformAddButtonText?: string;
  subformButtonState?: "normal" | "disabled" | "hidden";
  subformAllowBatchImport?: boolean;
  subformAllowExcelExport?: boolean;
  subformAllowBatchDelete?: boolean;
  subformFilterEmptyRows?: boolean;
  subformShowActionColumn?: boolean;
  subformShowCopyButton?: boolean;
  subformShowDeleteButton?: boolean;
  subformDeleteButtonText?: string;
  subformConfirmDelete?: boolean;
  subformShowSort?: boolean;
  subformDisplayMode?: "desktop" | "mobile";
  subformArrangement?: "tile" | "table";
  subformTheme?: "zebra" | "divider" | "border";
  subformShowHeader?: boolean;
  subformShowIndex?: boolean;
  subformLayoutMode?: "auto" | "fixed";
  subformPageSize?: number;
  subformMaxRows?: number;
  subformFrozenLeftColumns?: number;
  subformFreezeActionColumn?: boolean;
  subformActionColumnWidth?: number;
  subformAllowCustomColumns?: boolean;
  subformEnableTotals?: boolean;
  serialNumberDigits?: number;
  serialNumberFixedDigits?: boolean;
  serialNumberResetPeriod?: "never" | "daily" | "monthly" | "yearly";
  serialNumberInitialValue?: number;
  serialNumberRules?: Array<
    | { id: string; type: "autoCount"; digits: number; fixedDigits: boolean; resetPeriod: "never" | "daily" | "monthly" | "yearly"; initialValue: number }
    | { id: string; type: "fixedText"; value: string }
    | { id: string; type: "submittedDate"; format: "year" | "yearMonth" | "yearMonthDay" | "yearMonthDayHourMinute" | "yearMonthDayHourMinuteSecond" }
    | { id: string; type: "formField"; fieldId: string; fallback: string }
  >;
  associationFormId?: string;
  associationAppId?: string;
  associationPrimaryFieldId?: string;
  associationSecondaryFieldId?: string;
  associationTableFieldIds?: string[];
  associationFilters?: Array<{ fieldId: string; operator: string; value: string }>;
  associationFills?: Array<{ sourceFieldId: string; targetFieldId: string }>;
  associationSubformFills?: Array<{
    sourceSubformId: string;
    targetSubformId: string;
    mappings: Array<{ sourceFieldId: string; targetFieldId: string }>;
  }>;
  associationSorts?: Array<{ fieldId: string; direction: "asc" | "desc" }>;
  memberOrganizationSource?: "local" | "dingtalk" | "wecom" | "feishu";
  memberSelectableScope?: "all" | "roles" | "members";
  memberRoleIds?: string[];
  memberUserIds?: string[];
  memberDisplayFormat?: "name" | "nameJobNumber" | "nameUserId";
  memberMultiple?: boolean;
  locationDepth?: number;
  dataSource?: unknown;
  code?: string;
  allowedResourceOrigins?: string[];
};

export type RuntimeSchemaField = {
  id: string;
  type: RuntimeFieldType;
  label: string;
  row: number;
  column: number;
  rowSpan?: number;
  colSpan?: number;
  parentGroupId?: string | null;
  props?: RuntimeFieldProps;
};

export type RuntimeDataSource = {
  id: string;
  name: string;
  kind: "string" | "number" | "boolean" | "object";
  initialValue: string;
  description?: string;
};

export type RuntimePageAsset = {
  id: string;
  name: string;
  type: "script" | "style";
  url: string;
  integrity?: string;
  enabled: boolean;
};

export type RuntimeFieldAction = {
  id: string;
  fieldId: string;
  eventName: string;
  script: string;
};

export type RuntimeActionPanelState = {
  code: string;
  didMount?: string;
  onSubmit?: string;
  fieldEvents?: RuntimeFieldAction[];
};

export type RuntimePageProps = {
  submitButtonText?: string;
  table?: {
    sortableFieldIds?: string[];
  };
  dataSources?: RuntimeDataSource[];
  assets?: RuntimePageAsset[];
  actionPanel?: Partial<RuntimeActionPanelState>;
  agent?: {
    enabled?: boolean;
    agentId?: string;
    prompt?: string;
    context?: {
      generated?: string;
      status?: "idle" | "analyzing" | "ready" | "stale" | "failed";
      error?: string;
    };
  };
};

export type RuntimeFormSchema = {
  formUuid: string;
  formName?: string;
  columns: number;
  rows: number;
  fields: RuntimeSchemaField[];
  pageProps?: RuntimePageProps;
};

export type RuntimeFormRendererProps = {
  schema: RuntimeFormSchema;
  submitLabel: string;
  formId?: string;
  submitting?: boolean;
  showSubmitButton?: boolean;
  isReadOnly?: boolean;
  initialValues?: Record<string, unknown>;
  urlParams?: Record<string, string>;
  onDebugEvent?: (event: RuntimeDebugEvent) => void;
  onValuesChange?: (values: Record<string, unknown>) => void;
  valuePatch?: { id: number; values: Record<string, unknown> };
  onSubmit: (values: Record<string, unknown>) => Promise<void> | void;
};

export type RuntimeDebugEvent = {
  id: string;
  type: "didMount" | "field" | "submit";
  fieldId?: string;
  eventName: string;
  status: "success" | "error";
  message: string;
  result?: string;
  createdAt: string;
};
