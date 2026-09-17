import type { RuntimeFormSchema } from "@features/form-runtime/components";

/** Converts a detail form to the single-column runtime layout expected by record editing. */
export function normalizeDetailFormSchema(
  schema: RuntimeFormSchema,
  isDetailForm: boolean,
): RuntimeFormSchema {
  if (!isDetailForm) return schema;

  const fields = [...schema.fields]
    .sort(
      (left, right) =>
        left.row - right.row ||
        left.column - right.column ||
        left.id.localeCompare(right.id),
    )
    .map((field, row) => ({
      ...field,
      parentGroupId: null,
      row,
      column: 0,
      rowSpan: 1,
      colSpan: 1,
    }));

  return { ...schema, columns: 1, rows: Math.max(fields.length, 1), fields };
}
