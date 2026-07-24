import type { PlacedField } from "./designer-types";

export type DesignerSchemaValidationIssue = {
  code: "empty-container" | "association-display" | "duplicate-serial-number";
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

  const serialNumberScopes = new Map<string, PlacedField[]>();
  for (const field of fields.filter((item) => item.type === "serialNumber")) {
    const scope = getSerialNumberScope(field, fields);
    const scopedFields = serialNumberScopes.get(scope) ?? [];
    scopedFields.push(field);
    serialNumberScopes.set(scope, scopedFields);
  }

  const serialNumberIssues = [...serialNumberScopes.entries()].flatMap(
    ([scope, scopedFields]) => scopedFields.slice(1).map((field) => ({
      code: "duplicate-serial-number" as const,
      fieldId: field.id,
      message: scope === "canvas"
        ? "主画布只能添加一个流水号组件"
        : "每个子表单只能添加一个流水号组件",
    })),
  );

  return [
    ...serialNumberIssues,
    ...fields.flatMap<DesignerSchemaValidationIssue>((field) => {
    if (field.type === "associationFormField") {
      if (!field.props.associationFormId || !field.props.associationPrimaryFieldId) {
        return [{
          code: "association-display" as const,
          fieldId: field.id,
          message: `关联表单“${field.label.trim() || "关联表单"}”需要选择关联表单并完成显示设置`,
        }];
      }
      return [];
    }
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
    }),
  ];
}

function getSerialNumberScope(field: PlacedField, fields: PlacedField[]) {
  const fieldsById = new Map(fields.map((item) => [item.id, item]));
  let parentId = field.parentGroupId;
  while (parentId) {
    const parent = fieldsById.get(parentId);
    if (!parent) break;
    if (parent.type === "subform") return `subform:${parent.id}`;
    parentId = parent.parentGroupId;
  }
  return "canvas";
}
