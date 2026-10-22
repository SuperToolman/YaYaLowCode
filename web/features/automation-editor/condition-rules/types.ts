export type BranchRuleOperator =
  | "eq"
  | "neq"
  | "inAny"
  | "notInAny"
  | "hasValue"
  | "noValue";

export type BranchRule = {
  id: string;
  parentId?: string;
  isGroup?: boolean;
  logicalOperator?: "and" | "or";
  fieldKey?: string;
  operator?: BranchRuleOperator;
  rawValue?: string;
  valueType?: "value" | "field";
  sourceFieldKey?: string;
};

export type SourceFieldChoice = {
  key: string;
  label: string;
  fieldType: string;
  options: { label: string; value: string }[];
  isSystem?: boolean;
};
