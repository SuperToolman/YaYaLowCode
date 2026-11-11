type AssociationFillField = {
  id: string;
  type: string;
  parentGroupId?: string | null;
};

const NON_FILLABLE_FIELD_TYPES = new Set([
  "separator",
  "groupContainer",
  "subform",
  "description",
  "button",
]);

export function getAssociationMainTableFields<T extends AssociationFillField>(
  fields: T[],
): T[] {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));

  return fields.filter((field) => {
    if (NON_FILLABLE_FIELD_TYPES.has(field.type)) return false;

    const visited = new Set([field.id]);
    let parentId = field.parentGroupId;
    while (parentId) {
      if (visited.has(parentId)) return false;
      visited.add(parentId);

      const parent = fieldsById.get(parentId);
      if (!parent) break;
      if (parent.type === "subform") return false;
      parentId = parent.parentGroupId;
    }

    return true;
  });
}
