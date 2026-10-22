export type FieldValueType = "value" | "field" | "formula";

export type FieldMappingRow = {
  id: string;
  fieldId: string;
  valueType: FieldValueType;
  rawValue?: string;
  sourceFieldKey?: string;
  formula?: string;
};

export type FormFieldDescriptor = {
  id: string;
  label: string;
  type: string;
  parentGroupId?: string;
  isRequired: boolean;
  options: Array<{ label: string; value: string }>;
};
