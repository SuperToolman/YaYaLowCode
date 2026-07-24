import type { DesignerComponentType } from "./components/CompTool";
import {
  COLUMN_COUNT,
  GRID_COLUMN_GAP,
  MIN_ROW_COUNT,
} from "./designer-constants";
import type { PlacedField, ResizeState } from "./designer-types";

type FieldRectangle = Pick<
  PlacedField,
  "row" | "column" | "rowSpan" | "colSpan"
>;

type ComponentResizeCapabilities = {
  columns: boolean;
  rows: boolean;
};

const COMPONENT_RESIZE_CAPABILITIES: Record<
  DesignerComponentType,
  ComponentResizeCapabilities
> = {
  singleLineText: { columns: true, rows: false },
  number: { columns: true, rows: false },
  link: { columns: true, rows: false },
  select: { columns: true, rows: false },
  multiSelect: { columns: true, rows: false },
  date: { columns: true, rows: false },
  dateRange: { columns: true, rows: false },
  attachment: { columns: true, rows: false },
  imageUpload: { columns: true, rows: false },
  member: { columns: true, rows: false },
  department: { columns: true, rows: false },
  button: { columns: true, rows: false },
  description: { columns: false, rows: true },
  radio: { columns: true, rows: true },
  checkbox: { columns: true, rows: true },
  groupContainer: { columns: true, rows: true },
  subform: { columns: false, rows: false },
  richText: { columns: false, rows: true },
  serialNumber: { columns: true, rows: false },
  associationFormField: { columns: true, rows: false },
  countryCity: { columns: true, rows: false },
  cascader: { columns: true, rows: false },
  multiLineText: { columns: true, rows: true },
};

export function getComponentResizeCapabilities(
  type: DesignerComponentType,
): ComponentResizeCapabilities {
  return COMPONENT_RESIZE_CAPABILITIES[type] ?? { columns: false, rows: false };
}

export function createDesignerCells(rowCount: number) {
  return Array.from({ length: rowCount * COLUMN_COUNT }, (_, index) => ({
    row: Math.floor(index / COLUMN_COUNT),
    column: index % COLUMN_COUNT,
  }));
}

export function getRowCount(fields: PlacedField[]) {
  const maxFieldBottom = fields.reduce(
    (maxBottom, field) =>
      field.parentGroupId
        ? maxBottom
        : Math.max(maxBottom, field.row + field.rowSpan),
    0,
  );

  return Math.max(MIN_ROW_COUNT, maxFieldBottom + 1);
}

export function getFieldAt(
  fields: PlacedField[],
  row: number,
  column: number,
) {
  return fields.find((field) => field.row === row && field.column === column);
}

export function isCellCovered(
  fields: PlacedField[],
  row: number,
  column: number,
) {
  return fields.some((field) =>
    rectanglesOverlap({ row, column, rowSpan: 1, colSpan: 1 }, field),
  );
}

export function moveField(
  fields: PlacedField[],
  fieldId: string,
  row: number,
  column: number,
  parentGroupId?: string | null,
) {
  const targetField = fields.find((field) => field.id === fieldId);

  if (!targetField) {
    return fields;
  }

  const nextParentGroupId =
    parentGroupId === undefined ? (targetField?.parentGroupId ?? null) : parentGroupId;

  const nextParent = nextParentGroupId
    ? fields.find((field) => field.id === nextParentGroupId)
    : null;

  if (
    nextParentGroupId === targetField.id ||
    (isContainerFieldType(targetField.type) &&
      nextParentGroupId !== null &&
      collectGroupDescendantIds(fields, targetField.id).has(nextParentGroupId))
  ) {
    return fields;
  }

  if (
    nextParent?.type === "subform" &&
    (isContainerFieldType(targetField.type) || targetField.type === "richText")
  ) {
    return fields;
  }

  const targetRowSpan = nextParent?.type === "subform" ? 1 : targetField.rowSpan;
  const richTextLayout = getRichTextScopeLayout(nextParent);
  const targetColSpan = targetField.type === "subform"
    ? nextParent?.type === "groupContainer"
      ? nextParent.colSpan
      : COLUMN_COUNT
    : targetField.type === "richText"
      ? richTextLayout.colSpan
    : nextParent?.type === "subform"
      ? 1
      : targetField.colSpan;
  const targetColumn = targetField.type === "subform"
    ? nextParent?.type === "groupContainer"
      ? nextParent.column
      : 0
    : targetField.type === "richText"
      ? richTextLayout.column
      : column;

  if (
    targetField.row === row &&
    targetField.column === targetColumn &&
    (targetField.parentGroupId ?? null) === nextParentGroupId
  ) {
    return fields;
  }

  if (
    !canPlaceField(
      fields,
      fieldId,
      row,
      targetColumn,
      targetRowSpan,
      targetColSpan,
      nextParentGroupId,
    )
  ) {
    return fields;
  }

  if (isContainerFieldType(targetField.type)) {
    const deltaRow = row - targetField.row;
    const deltaColumn = targetColumn - targetField.column;
    const descendantIds = collectGroupDescendantIds(fields, targetField.id);

    return fields.map((field) => {
      if (field.id === fieldId || descendantIds.has(field.id)) {
        return {
          ...field,
          row: field.row + deltaRow,
          column: field.column + deltaColumn,
          parentGroupId:
            field.id === fieldId ? nextParentGroupId : field.parentGroupId ?? null,
        };
      }
      return field;
    });
  }

  return normalizeRichTextLayouts(fields.map((field) =>
    field.id === fieldId ? { ...field, row, column: targetColumn, rowSpan: targetRowSpan, colSpan: targetColSpan, parentGroupId: nextParentGroupId } : field,
  ));
}

export type FieldInsertionDirection =
  | "before-row"
  | "after-row"
  | "before-column"
  | "after-column";

export type FieldInsertionPlan = {
  valid: boolean;
  fields: PlacedField[];
  target: { row: number; column: number; parentGroupId: string | null };
  affectedFieldIds: string[];
  reason?: string;
};

type IncomingFieldLayout = Pick<PlacedField, "colSpan" | "rowSpan" | "type"> & {
  fieldId: string | null;
};

/** Plans an Android-launcher-style insertion without placing the dragged item. */
export function planFieldInsertion(
  fields: PlacedField[],
  incoming: IncomingFieldLayout,
  targetFieldId: string,
  direction: FieldInsertionDirection,
): FieldInsertionPlan {
  const targetField = fields.find((field) => field.id === targetFieldId);
  const fallbackTarget = {
    row: targetField?.row ?? 0,
    column: targetField?.column ?? 0,
    parentGroupId: targetField?.parentGroupId ?? null,
  };

  if (!targetField || incoming.fieldId === targetFieldId) {
    return invalidInsertionPlan(fields, fallbackTarget, "请选择其他组件作为插入位置");
  }

  const parentGroupId = targetField.parentGroupId ?? null;
  const parentField = parentGroupId
    ? fields.find((field) => field.id === parentGroupId)
    : null;

  if (parentField?.type === "subform" && isContainerFieldType(incoming.type)) {
    return invalidInsertionPlan(fields, fallbackTarget, "容器组件不能插入当前容器");
  }

  if (incoming.fieldId) {
    const draggedField = fields.find((field) => field.id === incoming.fieldId);
    if (
      draggedField &&
      isContainerFieldType(draggedField.type) &&
      collectGroupDescendantIds(fields, draggedField.id).has(parentGroupId ?? "")
    ) {
      return invalidInsertionPlan(fields, fallbackTarget, "容器不能插入自身的子级");
    }
  }

  if (
    (direction === "before-column" || direction === "after-column") &&
    (incoming.type === "subform" || incoming.type === "richText" || targetField.type === "richText")
  ) {
    return invalidInsertionPlan(fields, fallbackTarget, "富文本固定跨全行，请从组件上方或下方插入");
  }

  if (
    (direction === "before-row" || direction === "after-row") &&
    parentField?.type === "subform"
  ) {
    return invalidInsertionPlan(fields, fallbackTarget, "子表单为固定单行布局，请从组件左侧或右侧插入");
  }

  const ignoredIds = incoming.fieldId
    ? new Set([incoming.fieldId, ...collectGroupDescendantIds(fields, incoming.fieldId)])
    : new Set<string>();
  const draggedFields = fields.filter((field) => ignoredIds.has(field.id));
  const workingFields = fields.filter((field) => !ignoredIds.has(field.id));
  if (parentField?.type === "subform" && incoming.type === "richText") {
    return invalidInsertionPlan(fields, fallbackTarget, "富文本不能添加到子表单");
  }

  const normalizedIncoming = parentField?.type === "subform"
    ? { ...incoming, rowSpan: 1, colSpan: 1 }
    : incoming.type === "richText"
      ? { ...incoming, ...getRichTextScopeLayout(parentField) }
    : incoming.type === "subform" && parentField?.type === "groupContainer"
      ? { ...incoming, rowSpan: 1, colSpan: parentField.colSpan }
      : incoming;

  const planned = direction === "before-row" || direction === "after-row"
    ? planRowInsertion(workingFields, normalizedIncoming, targetField, direction)
    : planColumnInsertion(workingFields, normalizedIncoming, targetField, direction);

  if (!planned.valid) return planned;
  return {
    ...planned,
    fields: [...planned.fields, ...draggedFields],
  };
}

function planRowInsertion(
  fields: PlacedField[],
  incoming: IncomingFieldLayout,
  targetField: PlacedField,
  direction: Extract<FieldInsertionDirection, "before-row" | "after-row">,
): FieldInsertionPlan {
  const parentGroupId = targetField.parentGroupId ?? null;
  const parentField = parentGroupId
    ? fields.find((field) => field.id === parentGroupId)
    : null;
  const targetColumn = incoming.type === "subform" || incoming.type === "richText"
    ? parentField?.type === "groupContainer" ? parentField.column : 0
    : Math.min(targetField.column, COLUMN_COUNT - incoming.colSpan);
  const target = {
    row: direction === "after-row"
      ? targetField.row + targetField.rowSpan
      : targetField.row,
    column: targetColumn,
    parentGroupId,
  };
  const affectedFieldIds = new Set<string>();
  let nextFields = fields;
  const pushQueue: Array<FieldRectangle & { fieldId: string | null }> = [
    {
      row: target.row,
      column: target.column,
      rowSpan: incoming.rowSpan,
      colSpan: incoming.colSpan,
      fieldId: null,
    },
  ];
  let pushCount = 0;

  while (pushQueue.length > 0 && pushCount < fields.length * fields.length + 10) {
    const pusher = pushQueue.shift()!;

    while (true) {
      const blocker = nextFields
        .filter(
          (field) =>
            field.id !== pusher.fieldId &&
            (field.parentGroupId ?? null) === parentGroupId &&
            rectanglesOverlap(pusher, field),
        )
        .sort(compareFieldPosition)[0];
      if (!blocker) break;

      const nextRow = pusher.row + pusher.rowSpan;
      const deltaRow = Math.max(1, nextRow - blocker.row);
      nextFields = translateFieldRoots(
        nextFields,
        new Set([blocker.id]),
        deltaRow,
        0,
      );
      affectedFieldIds.add(blocker.id);
      const movedBlocker = nextFields.find((field) => field.id === blocker.id)!;
      pushQueue.push({
        row: movedBlocker.row,
        column: movedBlocker.column,
        rowSpan: movedBlocker.rowSpan,
        colSpan: movedBlocker.colSpan,
        fieldId: movedBlocker.id,
      });
      pushCount += 1;
    }
  }

  if (pushCount >= fields.length * fields.length + 10) {
    return invalidInsertionPlan(fields, target, "组件碰撞关系过于复杂，无法自动腾位");
  }

  if (parentGroupId) {
    const requiredBottom = Math.max(
      target.row + incoming.rowSpan,
      ...nextFields
        .filter((field) => field.parentGroupId === parentGroupId)
        .map((field) => field.row + field.rowSpan),
    );
    nextFields = expandContainerToFit(nextFields, parentGroupId, requiredBottom);
  }

  if (
    !canPlaceField(
      nextFields,
      null,
      target.row,
      target.column,
      incoming.rowSpan,
      incoming.colSpan,
      parentGroupId,
    )
  ) {
    return invalidInsertionPlan(fields, target, "当前位置无法腾出足够空间");
  }

  return {
    valid: true,
    fields: nextFields,
    target,
    affectedFieldIds: [...affectedFieldIds],
  };
}

function planColumnInsertion(
  fields: PlacedField[],
  incoming: IncomingFieldLayout,
  targetField: PlacedField,
  direction: Extract<FieldInsertionDirection, "before-column" | "after-column">,
): FieldInsertionPlan {
  const parentGroupId = targetField.parentGroupId ?? null;
  const parentField = parentGroupId
    ? fields.find((field) => field.id === parentGroupId)
    : null;
  const columnStart = parentField?.column ?? 0;
  const siblings = fields
    .filter((field) => (field.parentGroupId ?? null) === parentGroupId)
    .sort(compareFieldPosition);
  const columnEnd = parentField?.type === "subform"
    ? Math.max(
        columnStart + 1,
        ...siblings.map((field) => field.column + field.colSpan),
      ) + incoming.colSpan + siblings.length
    : parentField
      ? parentField.column + parentField.colSpan
      : COLUMN_COUNT;
  let target = {
    row: targetField.row,
    column: direction === "after-column"
      ? targetField.column + targetField.colSpan
      : targetField.column,
    parentGroupId,
  };
  if (target.column + incoming.colSpan > columnEnd && parentField?.type !== "subform") {
    target = { ...target, row: target.row + 1, column: columnStart };
  }
  const affectedFieldIds = new Set<string>();
  let nextFields = fields;
  const pushQueue: Array<FieldRectangle & { fieldId: string | null }> = [
    {
      row: target.row,
      column: target.column,
      rowSpan: incoming.rowSpan,
      colSpan: incoming.colSpan,
      fieldId: null,
    },
  ];
  let pushCount = 0;

  while (pushQueue.length > 0 && pushCount < fields.length * fields.length + 10) {
    const pusher = pushQueue.shift()!;

    while (true) {
      const blocker = nextFields
        .filter(
          (field) =>
            field.id !== pusher.fieldId &&
            (field.parentGroupId ?? null) === parentGroupId &&
            rectanglesOverlap(pusher, field),
        )
        .sort(compareFieldPosition)[0];
      if (!blocker) break;

      let nextRow = blocker.row;
      let nextColumn = pusher.column + pusher.colSpan;
      if (nextColumn + blocker.colSpan > columnEnd) {
        if (parentField?.type === "subform") {
          nextColumn = columnEnd;
        } else {
          nextRow = Math.max(blocker.row, pusher.row) + 1;
          nextColumn = columnStart;
        }
      }

      const deltaRow = nextRow - blocker.row;
      const deltaColumn = nextColumn - blocker.column;
      nextFields = translateFieldRoots(
        nextFields,
        new Set([blocker.id]),
        deltaRow,
        deltaColumn,
      );
      affectedFieldIds.add(blocker.id);
      const movedBlocker = nextFields.find((field) => field.id === blocker.id)!;
      pushQueue.push({
        row: movedBlocker.row,
        column: movedBlocker.column,
        rowSpan: movedBlocker.rowSpan,
        colSpan: movedBlocker.colSpan,
        fieldId: movedBlocker.id,
      });
      pushCount += 1;
    }
  }

  if (pushCount >= fields.length * fields.length + 10) {
    return invalidInsertionPlan(fields, target, "组件碰撞关系过于复杂，无法自动腾位");
  }

  if (
    !canPlaceField(
      nextFields,
      null,
      target.row,
      target.column,
      incoming.rowSpan,
      incoming.colSpan,
      parentGroupId,
    )
  ) {
    return invalidInsertionPlan(fields, target, "当前位置无法腾出足够空间");
  }

  if (parentGroupId) {
    const requiredBottom = Math.max(
      target.row + incoming.rowSpan,
      ...nextFields
        .filter((field) => field.parentGroupId === parentGroupId)
        .map((field) => field.row + field.rowSpan),
    );
    nextFields = expandContainerToFit(nextFields, parentGroupId, requiredBottom);
  }

  return {
    valid: true,
    fields: nextFields,
    target,
    affectedFieldIds: [...affectedFieldIds],
  };
}

function translateFieldRoots(
  fields: PlacedField[],
  rootIds: Set<string>,
  deltaRow: number,
  deltaColumn: number,
) {
  const translatedIds = new Set(rootIds);
  for (const rootId of rootIds) {
    for (const descendantId of collectGroupDescendantIds(fields, rootId)) {
      translatedIds.add(descendantId);
    }
  }
  return fields.map((field) =>
    translatedIds.has(field.id)
      ? { ...field, row: field.row + deltaRow, column: field.column + deltaColumn }
      : field,
  );
}

function expandContainerToFit(
  fields: PlacedField[],
  containerId: string,
  requiredBottom: number,
): PlacedField[] {
  const container = fields.find((field) => field.id === containerId);
  if (!container || container.type !== "groupContainer") return fields;
  const currentBottom = container.row + container.rowSpan;
  const deltaRows = Math.max(0, requiredBottom - currentBottom);
  if (deltaRows === 0) return fields;

  const siblingIds = new Set(
    fields
      .filter(
        (field) =>
          field.id !== container.id &&
          (field.parentGroupId ?? null) === (container.parentGroupId ?? null) &&
          field.row >= currentBottom,
      )
      .map((field) => field.id),
  );
  let nextFields = translateFieldRoots(fields, siblingIds, deltaRows, 0).map(
    (field) =>
      field.id === container.id
        ? { ...field, rowSpan: field.rowSpan + deltaRows }
        : field,
  );

  if (container.parentGroupId) {
    nextFields = expandContainerToFit(
      nextFields,
      container.parentGroupId,
      currentBottom + deltaRows,
    );
  }
  return normalizeRichTextLayouts(nextFields);
}

export function expandGroupToFit(
  fields: PlacedField[],
  groupId: string | null,
  requiredBottom: number,
) {
  if (!groupId) return fields;
  return expandContainerToFit(fields, groupId, requiredBottom);
}

function invalidInsertionPlan(
  fields: PlacedField[],
  target: FieldInsertionPlan["target"],
  reason: string,
): FieldInsertionPlan {
  return { valid: false, fields, target, affectedFieldIds: [], reason };
}

function compareFieldPosition(left: PlacedField, right: PlacedField) {
  return left.row - right.row || left.column - right.column;
}

export function resizeField(
  fields: PlacedField[],
  resizeState: ResizeState,
  deltaRows: number,
  deltaColumns: number,
) {
  const targetField = fields.find((field) => field.id === resizeState.fieldId);

  if (!targetField) {
    return fields;
  }

  const resizeCapabilities = getComponentResizeCapabilities(targetField.type);
  const shouldResizeColumns =
    resizeCapabilities.columns &&
    (resizeState.direction === "columns" || resizeState.direction === "both");
  const shouldResizeRows =
    resizeCapabilities.rows &&
    (resizeState.direction === "rows" || resizeState.direction === "both");

  const nextColSpan =
    shouldResizeColumns
      ? clamp(
          resizeState.startColSpan + deltaColumns,
          1,
          COLUMN_COUNT - targetField.column,
        )
      : targetField.colSpan;
  const nextRowSpan =
    shouldResizeRows
      ? Math.max(1, resizeState.startRowSpan + deltaRows)
      : targetField.rowSpan;

  if (
    targetField.colSpan === nextColSpan &&
    targetField.rowSpan === nextRowSpan
  ) {
    return fields;
  }

  if (
    !canResizeGroupWithinChildren(
      fields,
      targetField,
      nextRowSpan,
      nextColSpan,
    )
  ) {
    return fields;
  }

  return planResizeReflow(
    fields,
    targetField,
    nextRowSpan,
    nextColSpan,
  );
}

function planResizeReflow(
  fields: PlacedField[],
  targetField: PlacedField,
  nextRowSpan: number,
  nextColSpan: number,
) {
  const parentGroupId = targetField.parentGroupId ?? null;
  const parentField = parentGroupId
    ? fields.find((field) => field.id === parentGroupId)
    : null;
  const isSubformChild = parentField?.type === "subform";

  if (
    (!isSubformChild && targetField.column + nextColSpan > COLUMN_COUNT) ||
    (parentField?.type === "groupContainer" &&
      targetField.column + nextColSpan > parentField.column + parentField.colSpan)
  ) {
    return fields;
  }

  let nextFields = fields.map((field) =>
    field.id === targetField.id
      ? { ...field, rowSpan: nextRowSpan, colSpan: nextColSpan }
      : field,
  );
  const pushQueue: Array<FieldRectangle & { fieldId: string }> = [
    {
      row: targetField.row,
      column: targetField.column,
      rowSpan: nextRowSpan,
      colSpan: nextColSpan,
      fieldId: targetField.id,
    },
  ];
  let pushCount = 0;
  const maxPushCount = fields.length * fields.length + 10;

  while (pushQueue.length > 0 && pushCount < maxPushCount) {
    const pusher = pushQueue.shift()!;

    while (true) {
      const blocker = nextFields
        .filter(
          (field) =>
            field.id !== pusher.fieldId &&
            (field.parentGroupId ?? null) === parentGroupId &&
            rectanglesOverlap(pusher, field),
        )
        .sort(compareFieldPosition)[0];
      if (!blocker) break;

      const nextRow = pusher.row + pusher.rowSpan;
      const deltaRow = Math.max(1, nextRow - blocker.row);
      nextFields = translateFieldRoots(
        nextFields,
        new Set([blocker.id]),
        deltaRow,
        0,
      );
      const movedBlocker = nextFields.find((field) => field.id === blocker.id)!;
      pushQueue.push({
        row: movedBlocker.row,
        column: movedBlocker.column,
        rowSpan: movedBlocker.rowSpan,
        colSpan: movedBlocker.colSpan,
        fieldId: movedBlocker.id,
      });
      pushCount += 1;
    }
  }

  if (pushCount >= maxPushCount) return fields;

  if (parentGroupId && parentField?.type === "groupContainer") {
    const requiredBottom = Math.max(
      ...nextFields
        .filter((field) => field.parentGroupId === parentGroupId)
        .map((field) => field.row + field.rowSpan),
    );
    nextFields = expandContainerToFit(nextFields, parentGroupId, requiredBottom);
  }

  return normalizeRichTextLayouts(nextFields);
}

function canResizeGroupWithinChildren(
  fields: PlacedField[],
  targetField: PlacedField,
  nextRowSpan: number,
  nextColSpan: number,
) {
  if (targetField.type !== "groupContainer") return true;
  const descendantIds = collectGroupDescendantIds(fields, targetField.id);
  return fields.every(
    (field) =>
      !descendantIds.has(field.id) ||
      (field.type === "richText" && field.parentGroupId === targetField.id) ||
      (field.row >= targetField.row &&
        field.column >= targetField.column &&
        field.row + field.rowSpan <= targetField.row + nextRowSpan &&
        field.column + field.colSpan <= targetField.column + nextColSpan),
  );
}

export function canPlaceField(
  fields: PlacedField[],
  ignoredFieldId: string | null,
  row: number,
  column: number,
  rowSpan: number,
  colSpan: number,
  parentGroupId: string | null = null,
) {
  if (row < 0 || column < 0) {
    return false;
  }

  const parentGroup = parentGroupId
    ? fields.find((field) => field.id === parentGroupId)
    : null;
  const isSubformChild = parentGroup?.type === "subform";
  if (!isSubformChild && column + colSpan > COLUMN_COUNT) return false;

  const candidate = { row, column, rowSpan, colSpan };

  if (parentGroupId) {
    if (
      !parentGroup ||
      !isContainerFieldType(parentGroup.type) ||
      (parentGroup.type === "subform"
        ? row !== parentGroup.row || rowSpan !== 1 || colSpan !== 1
        : row < parentGroup.row ||
          column < parentGroup.column ||
          row + rowSpan > parentGroup.row + parentGroup.rowSpan ||
          column + colSpan > parentGroup.column + parentGroup.colSpan)
    ) {
      return false;
    }
  }

  return !fields.some(
      (field) =>
      field.id !== ignoredFieldId &&
      (field.parentGroupId ?? null) === parentGroupId &&
      rectanglesOverlap(candidate, field),
  );
}

export function rectanglesOverlap(
  left: FieldRectangle,
  right: FieldRectangle,
) {
  return (
    left.row < right.row + right.rowSpan &&
    left.row + left.rowSpan > right.row &&
    left.column < right.column + right.colSpan &&
    left.column + left.colSpan > right.column
  );
}

export function getColumnStep(grid: HTMLDivElement) {
  const rect = grid.getBoundingClientRect();

  return (
    (rect.width - GRID_COLUMN_GAP * (COLUMN_COUNT - 1)) / COLUMN_COUNT +
    GRID_COLUMN_GAP
  );
}

export function isTopAlignedField(type: DesignerComponentType) {
  return (
    type === "description" ||
    type === "multiLineText" ||
    type === "radio" ||
    type === "checkbox" ||
    type === "attachment" ||
    type === "imageUpload"
    || type === "serialNumber"
    || type === "richText"
    || type === "subform"
  );
}

export function getInitialFieldLayout(type: DesignerComponentType) {
  if (type === "groupContainer") {
    return { rowSpan: 2, colSpan: 2 };
  }

  if (type === "subform") {
    return { rowSpan: 1, colSpan: COLUMN_COUNT };
  }

  if (type === "richText" || type === "html" || type === "tsx") {
    return { rowSpan: 1, colSpan: COLUMN_COUNT };
  }

  if (type === "multiLineText") {
    return { rowSpan: 2, colSpan: 1 };
  }

  if (type === "countryCity") {
    return { rowSpan: 1, colSpan: 1 };
  }

  if (type === "attachment" || type === "imageUpload") {
    return { rowSpan: 1, colSpan: 1 };
  }

  return { rowSpan: 1, colSpan: 1 };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getTopLevelFields(fields: PlacedField[]) {
  return fields.filter((field) => !field.parentGroupId);
}

export function getChildFields(fields: PlacedField[], parentGroupId: string) {
  return fields.filter((field) => field.parentGroupId === parentGroupId);
}

export function collectGroupDescendantIds(fields: PlacedField[], groupId: string) {
  const result = new Set<string>();
  const queue = [groupId];

  while (queue.length > 0) {
    const currentGroupId = queue.shift();
    if (!currentGroupId) {
      continue;
    }

    for (const field of fields) {
      if (field.parentGroupId === currentGroupId && !result.has(field.id)) {
        result.add(field.id);
        if (isContainerFieldType(field.type)) {
          queue.push(field.id);
        }
      }
    }
  }

  return result;
}

export function isContainerFieldType(type: DesignerComponentType) {
  return type === "groupContainer" || type === "subform";
}

export function getRichTextScopeLayout(parent?: PlacedField | null) {
  return parent?.type === "groupContainer"
    ? { column: parent.column, colSpan: parent.colSpan }
    : { column: 0, colSpan: COLUMN_COUNT };
}

/** Keeps full-width rich-text fields aligned with their current canvas or group. */
export function normalizeRichTextLayouts(fields: PlacedField[]) {
  return fields.map((field) => {
    if (
      field.type === "attachment"
      || field.type === "imageUpload"
      || field.type === "countryCity"
    ) {
      // These controls have a fixed one-row height but can still span columns.
      return field.rowSpan === 1 ? field : { ...field, rowSpan: 1 };
    }

    if (field.type !== "richText") return field;
    const parent = field.parentGroupId
      ? fields.find((candidate) => candidate.id === field.parentGroupId)
      : null;
    const validParent = parent?.type === "subform" ? null : parent;
    return {
      ...field,
      ...getRichTextScopeLayout(validParent),
      parentGroupId: parent?.type === "subform" ? null : field.parentGroupId ?? null,
    };
  });
}
