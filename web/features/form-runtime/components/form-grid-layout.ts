type GridField = {
  type: string;
  row: number;
  rowSpan?: number;
  props?: { orientation?: string };
};

/** Only standalone horizontal separator rows use a compact height. */
export function getFormGridTemplateRows(
  fields: readonly GridField[],
  startRow = 0,
  rowCount = 0,
): string | undefined {
  const isCompact = (field: GridField) =>
    field.type === "separator" && field.props?.orientation !== "vertical";
  if (!fields.some(isCompact)) return undefined;

  const count = Math.max(
    rowCount,
    ...fields.map((field) => field.row - startRow + (field.rowSpan ?? 1)),
  );
  const compactRows = new Set<number>();
  const regularRows = new Set<number>();
  for (const field of fields) {
    const rows = isCompact(field) ? compactRows : regularRows;
    for (let row = field.row; row < field.row + (field.rowSpan ?? 1); row++) {
      rows.add(row);
    }
  }
  return Array.from({ length: count }, (_, index) => {
    const row = index + startRow;
    const height = compactRows.has(row) && !regularRows.has(row) ? 24 : 68;
    return `minmax(${height}px, auto)`;
  }).join(" ");
}
