export type FormRecord = Omit<import("@lib/http").ApiFormRecord, "data"> & { data: Record<string, unknown> };

export type RecordFilter = {
  fieldId: string;
  operator: "eq" | "neq" | "contains" | "in" | "isEmpty" | "isNotEmpty" | "gt" | "gte" | "lt" | "lte";
  value?: unknown;
};

export type RecordSort = { fieldId: string; direction: "asc" | "desc" };

export type RecordsPage = {
  items: FormRecord[];
  total: number;
  page: number;
  pageSize: number;
};

export type AssociationFormData<TSchema = unknown> = {
  schema: TSchema;
  records: Map<string, FormRecord>;
};

export type WorkflowAction = { action: string; operator: string; comment: string | null; createdAt: string };
export type WorkflowComment = { id: string; author: string; content: string; createdAt: string };
export type DetailForm = import("@lib/http").ApiDetailForm;
