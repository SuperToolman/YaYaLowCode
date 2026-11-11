import type { RuntimeFormSchema, RuntimeSchemaField } from "@/features/form-model/runtime-types";
import type { FormRecord } from "@/features/records/types";
import type { AssociationFormData } from "@/features/records/types";

type SchemaField = RuntimeSchemaField;
export type FormSchema = RuntimeFormSchema;
export type RecordTableRow = FormRecord & {
  subformId?: string;
  subformLabel?: string;
  children?: RecordTableRow[];
  rowNumber: number;
  displayValues: {
    fields: Record<string, string>;
    builtIns: Record<string, string>;
  };
  subformCounts?: Record<string, number>;
};
export type BuiltInTableColumn = {
  kind: "builtin";
  field: { id: string; label: string };
  index: number;
};
export type CombinedInstanceTableColumn = {
  kind: "combinedInstance";
  field: { id: "instanceId"; label: "实例标题" };
  index: number;
};
export type CombinedSubmitterTableColumn = {
  kind: "combinedSubmitter";
  field: { id: "submitter"; label: "创建人&组织" };
  index: number;
};
export type RecordTableColumn =
  | { kind: "field"; field: SchemaField; index: number }
  | { kind: "subformSummary"; field: { id: string; label: string }; parentSubformId?: string; index: number }
  | BuiltInTableColumn
  | CombinedInstanceTableColumn
  | CombinedSubmitterTableColumn;
export type TableAssociationFormData = AssociationFormData<FormSchema>;
export type AssociationDetail = {
  field: SchemaField;
  record: FormRecord;
  schema: FormSchema;
};
