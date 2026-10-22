import * as XLSX from "xlsx";
import type { RuntimeSchemaField } from "@features/form-runtime/components";

export function buildImportTemplate(
  fields: ImportSchemaField[],
  builtins: readonly { label: string }[],
) {
  const columns = fields.filter((field) => field.type !== "subform");
  if (!columns.some((field) => field.subformId))
    return {
      matrix: [
        [
          ...columns.map((field) => field.label),
          ...builtins.map((field) => field.label),
        ],
      ],
      merges: [],
    };
  const parents = fields.filter((field) => field.type === "subform");
  const ordered = columns.filter((field) => !field.subformId);
  for (const parent of parents)
    ordered.push(...columns.filter((field) => field.subformId === parent.id));
  const matrix: string[][] = [[], []];
  const merges: XLSX.Range[] = [];
  for (const field of ordered) {
    const col = matrix[0].length;
    const parent = parents.find((item) => item.id === field.subformId);
    matrix[0].push(parent?.label ?? field.label);
    matrix[1].push(
      parent ? field.label.slice(parent.label.length + 3) : field.label,
    );
    if (!parent) merges.push({ s: { r: 0, c: col }, e: { r: 1, c: col } });
    else if (ordered[col - 1]?.subformId === parent.id)
      merges[merges.length - 1].e.c = col;
    else merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col } });
  }
  for (const field of builtins) {
    const col = matrix[0].length;
    matrix[0].push(field.label);
    matrix[1].push(field.label);
    merges.push({ s: { r: 0, c: col }, e: { r: 1, c: col } });
  }
  return {
    matrix,
    merges: merges.filter(
      (merge) => merge.s.r !== merge.e.r || merge.s.c !== merge.e.c,
    ),
  };
}

export type ExcelImportColumn = { id: string; label: string; header: string };
export type ParsedExcelImport = {
  headers: string[];
  rows: unknown[][];
  mappings: Record<number, string>;
  rowGroups: number[];
};
export type ImportSchemaField = RuntimeSchemaField & { subformId?: string };

export function getMissingRequiredImportFields(
  fields: readonly { id: string; type: string; subformId?: string; props?: { isRequired?: boolean } }[],
  mappings: Record<number, string>,
) {
  const mapped = new Set(Object.values(mappings).filter(Boolean));
  return fields.filter((field) => {
    if (!field.props?.isRequired || mapped.has(field.id)) return false;
    // A subform can be supplied as JSON or through its individual columns.
    if (field.subformId && mapped.has(field.subformId)) return false;
    if (field.type === "subform" && fields.some((child) => child.subformId === field.id && mapped.has(child.id))) return false;
    return true;
  }).map((field) => field.id);
}

export function getExcelImportFields(
  fields: RuntimeSchemaField[],
): ImportSchemaField[] {
  const byId = new Map(fields.map((field) => [field.id, field]));
  return fields.flatMap((field) => {
    if (
      [
        "description",
        "groupContainer",
        "button",
        "link",
        "html",
        "tsx",
        "serialNumber",
      ].includes(field.type)
    )
      return [];
    let current: RuntimeSchemaField | undefined = field;
    let parent: RuntimeSchemaField | undefined;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (
        current.props?.isHidden ||
        current.props?.isDisabled ||
        current.props?.isReadOnly ||
        current.props?.defaultValueType === "formula"
      )
        return [];
      if (current !== field && current.type === "subform") parent = current;
      current = current.parentGroupId
        ? byId.get(current.parentGroupId)
        : undefined;
    }
    return [
      {
        ...field,
        label: parent ? `${parent.label} / ${field.label}` : field.label,
        subformId: parent?.id,
      },
    ];
  });
}

export function parseImportWorksheet(
  sheet: XLSX.WorkSheet,
  columns: ExcelImportColumn[],
): ParsedExcelImport {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true,
    range: 0,
  });
  const merges = sheet["!merges"] ?? [];
  const twoHeaders = merges.some(
    (merge) => merge.s.r === 0 && merge.e.r === 1 && merge.s.c === merge.e.c,
  );
  const headerRows = twoHeaders ? 2 : 1;
  const width = Math.max(
    matrix[0]?.length ?? 0,
    twoHeaders ? (matrix[1]?.length ?? 0) : 0,
  );
  if (!width) throw new Error("Excel 第一行必须包含字段标题");
  const text = (row: number, col: number) =>
    String(matrix[row]?.[col] ?? "").trim();
  const subColumns = new Set<number>();
  const headers = Array.from({ length: width }, (_, col) => {
    if (!twoHeaders) return text(0, col);
    const vertical = merges.some(
      (merge) =>
        merge.s.r === 0 &&
        merge.e.r === 1 &&
        merge.s.c === col &&
        merge.e.c === col,
    );
    const group = merges.find(
      (merge) =>
        merge.s.r === 0 &&
        merge.e.r === 0 &&
        merge.s.c <= col &&
        merge.e.c >= col,
    );
    const top = group ? text(0, group.s.c) : text(0, col);
    const child = text(1, col);
    if (!vertical && top && child && top !== child) {
      subColumns.add(col);
      return `${top} / ${child}`;
    }
    return top || child;
  });
  const mappings: Record<number, string> = {};
  headers.forEach((header, index) => {
    const matches = columns.filter(
      (column) =>
        column.header === header ||
        column.label === header ||
        column.id === header,
    );
    mappings[index] = matches.length === 1 ? matches[0].id : "";
  });
  // Only explicit merges in main-field columns establish a shared parent.
  // Do not merge unrelated records just because their displayed values match.
  const parentMerges = twoHeaders
    ? merges.filter(
        (merge) =>
          merge.s.r >= headerRows &&
          merge.e.r > merge.s.r &&
          merge.s.c === merge.e.c &&
          !subColumns.has(merge.s.c),
      )
    : [];
  const rows: unknown[][] = [];
  const rowGroups: number[] = [];
  for (let rowIndex = headerRows; rowIndex < matrix.length; rowIndex++) {
    const row = matrix[rowIndex];
    if (!row.some((cell) => String(cell ?? "").trim())) continue;
    const group = parentMerges.find(
      (merge) => merge.s.r <= rowIndex && merge.e.r >= rowIndex,
    );
    rows.push(row);
    rowGroups.push(group?.s.r ?? rowIndex);
  }
  return { headers, rows, mappings, rowGroups };
}

export function assembleImportRecords(
  rows: unknown[][],
  mappings: Record<number, string>,
  fields: ImportSchemaField[],
  rowGroups: number[] | undefined,
  convert: (field: ImportSchemaField, cell: unknown) => unknown,
) {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const mapped = Object.entries(mappings).filter(
    ([, id]) => id && byId.has(id),
  );
  const targets = mapped.map(([, id]) => id);
  if (new Set(targets).size !== targets.length)
    throw new Error("多个 Excel 列匹配了同一字段，请调整字段匹配。");
  for (const [, id] of mapped) {
    const parent = byId.get(id)?.subformId;
    if (parent && targets.includes(parent))
      throw new Error("子表整体与子字段不能同时导入，请忽略子表整体列。");
  }
  const records = new Map<
    number,
    { index: number; data: Record<string, unknown> }
  >();
  rows.forEach((row, index) => {
    const group = rowGroups?.[index] ?? index;
    const record = records.get(group) ?? { index, data: {} };
    records.set(group, record);
    const children = new Map<string, Record<string, unknown>>();
    for (const [col, id] of mapped) {
      const field = byId.get(id)!;
      const value = convert(field, row[Number(col)]);
      if (value === undefined) continue;
      if (field.subformId) {
        const child = children.get(field.subformId) ?? {};
        child[id] = value;
        children.set(field.subformId, child);
      } else if (!(id in record.data)) {
        record.data[id] = value;
      }
    }
    for (const [parentId, child] of children) {
      const list = (record.data[parentId] ??= []) as Record<string, unknown>[];
      list.push(child);
    }
  });
  return [...records.values()];
}
