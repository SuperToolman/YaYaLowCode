import { placePastedFields } from "./designer-clipboard";
import { isContainerFieldType, normalizeRichTextLayouts } from "./designer-layout";
import type { PlacedField } from "./designer-types";

export function placeToolboxField(
  fields: PlacedField[],
  incoming: PlacedField,
  activeFieldId: string | null,
): { fields: PlacedField[]; error?: never } | { fields?: never; error: string } {
  const active = fields.find((field) => field.id === activeFieldId);
  const parent = active && isContainerFieldType(active.type) ? active : null;
  if (parent?.type === "subform" && (isContainerFieldType(incoming.type) || incoming.type === "richText" || incoming.type === "separator")) {
    return { error: "子表单不能添加容器、富文本或分割线组件。" };
  }
  if (incoming.type === "serialNumber") {
    const scope = parent?.type === "subform" ? parent.id : null;
    if (fields.some((field) => {
      if (field.type !== "serialNumber") return false;
      let ancestor = fields.find((item) => item.id === field.parentGroupId);
      while (ancestor && ancestor.type !== "subform") {
        ancestor = fields.find((item) => item.id === ancestor?.parentGroupId);
      }
      return (ancestor?.id ?? null) === scope;
    })) {
      return { error: scope ? "每个子表单只能添加一个流水号组件。" : "主画布只能添加一个流水号组件。" };
    }
  }
  const field = {
    ...incoming,
    parentGroupId: parent?.id ?? null,
    row: parent?.row ?? 0,
    column: parent?.type === "groupContainer" ? parent.column : 0,
    ...(parent?.type === "subform" ? { rowSpan: 1, colSpan: 1 } : {}),
    ...(parent?.type === "groupContainer" && (incoming.type === "subform" || incoming.type === "richText" || incoming.type === "separator")
      ? { rowSpan: 1, colSpan: parent.colSpan } : {}),
  };
  const nextFields = placePastedFields(fields, [field]);
  return nextFields
    ? { fields: normalizeRichTextLayouts(nextFields) }
    : { error: "当前容器没有可用位置。" };
}
