import type { PlacedField } from "./designer-types";

export type DesignerSchemaValidationIssue = {
  code: "empty-container";
  fieldId: string;
  message: string;
};

const CONTAINER_NAMES: Partial<Record<PlacedField["type"], string>> = {
  groupContainer: "分组组件",
  subform: "子表单组件",
};

/**
 * Validates structural rules that must hold before a designer schema can be
 * persisted. Keep container-specific rules here so save and publish use the
 * same validation behavior.
 */
export function validateDesignerSchema(
  fields: PlacedField[],
): DesignerSchemaValidationIssue[] {
  const parentIds = new Set(
    fields
      .map((field) => field.parentGroupId)
      .filter((parentId): parentId is string => Boolean(parentId)),
  );

  return fields.flatMap((field) => {
    const containerName = CONTAINER_NAMES[field.type];
    if (!containerName || parentIds.has(field.id)) {
      return [];
    }

    const label = field.label.trim() || containerName;
    return [
      {
        code: "empty-container" as const,
        fieldId: field.id,
        message: `${containerName}“${label}”至少需要包含一个子组件`,
      },
    ];
  });
}
