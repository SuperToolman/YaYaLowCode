export type CascaderLabel = string | {
  type?: "i18n";
  zh_CN?: string;
  en_US?: string;
};

export type CascaderOption = {
  value: string;
  label: CascaderLabel;
  children?: CascaderOption[];
};

export const DEFAULT_CASCADER_DATA_SOURCE: CascaderOption[] = [
  {
    value: "part",
    label: { type: "i18n", en_US: "dep", zh_CN: "部门" },
    children: [
      { value: "part_a", label: "A部门" },
      { value: "part_b", label: "B部门" },
    ],
  },
  {
    value: "product",
    label: "产品",
    children: [
      { value: "product_a", label: "a产品" },
      { value: "product_b", label: "b产品" },
    ],
  },
];

const MAX_CASCADER_NODES = 2000;

export function normalizeCascaderDataSource(value: unknown): CascaderOption[] {
  if (!Array.isArray(value)) return [];

  let nodeCount = 0;
  const normalizeOptions = (items: unknown[]): CascaderOption[] => items.flatMap((item) => {
    if (nodeCount >= MAX_CASCADER_NODES || !isCascaderOption(item)) return [];
    nodeCount += 1;
    const children = Array.isArray(item.children) ? normalizeOptions(item.children) : [];
    return [{
      value: item.value.trim(),
      label: normalizeCascaderLabel(item.label),
      ...(children.length > 0 ? { children } : {}),
    }];
  });

  return normalizeOptions(value);
}

export function parseCascaderDataSource(value: string): CascaderOption[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const normalized = normalizeCascaderDataSource(parsed);
    return normalized.length === 0 && parsed.length > 0 ? null : normalized;
  } catch {
    return null;
  }
}

export function getCascaderLabel(label: CascaderLabel, locale = "zh_CN") {
  if (typeof label === "string") return label;
  return locale.startsWith("zh")
    ? label.zh_CN || label.en_US || ""
    : label.en_US || label.zh_CN || "";
}

export function getCascaderPath(
  options: CascaderOption[],
  value: string,
): CascaderOption[] {
  for (const option of options) {
    if (option.value === value) return [option];
    const nestedPath = option.children
      ? getCascaderPath(option.children, value)
      : [];
    if (nestedPath.length > 0) return [option, ...nestedPath];
  }
  return [];
}

export function getCascaderPathByValue(
  options: CascaderOption[],
  value: string,
): CascaderOption[] {
  const findSerializedPath = (
    items: CascaderOption[],
    parentPath: CascaderOption[],
  ): CascaderOption[] => {
    for (const option of items) {
      const currentPath = [...parentPath, option];
      if (serializeCascaderValue(currentPath) === value) return currentPath;
      const nestedPath = option.children
        ? findSerializedPath(option.children, currentPath)
        : [];
      if (nestedPath.length > 0) return nestedPath;
    }
    return [];
  };

  // Retain readable labels for records saved before path serialization was introduced.
  const serializedPath = findSerializedPath(options, []);
  return serializedPath.length > 0
    ? serializedPath
    : getCascaderPath(options, value);
}

export function serializeCascaderValue(path: CascaderOption[]) {
  return path.map((option) => option.value).join(".");
}

export function serializeCascaderLabel(path: CascaderOption[], locale = "zh_CN") {
  return path.map((option) => getCascaderLabel(option.label, locale)).join(".");
}

function isCascaderOption(value: unknown): value is { value: string; label: unknown; children?: unknown } {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { value?: unknown }).value === "string" &&
    (value as { value: string }).value.trim() &&
    isValidCascaderLabel((value as { label?: unknown }).label),
  );
}

function isValidCascaderLabel(value: unknown) {
  if (typeof value === "string") return value.trim().length > 0;
  if (!value || typeof value !== "object") return false;
  const label = value as { zh_CN?: unknown; en_US?: unknown };
  return (typeof label.zh_CN === "string" && label.zh_CN.trim().length > 0)
    || (typeof label.en_US === "string" && label.en_US.trim().length > 0);
}

function normalizeCascaderLabel(value: unknown): CascaderLabel {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const label = value as { type?: unknown; zh_CN?: unknown; en_US?: unknown };
    if (typeof label.zh_CN === "string" || typeof label.en_US === "string") {
      return {
        ...(label.type === "i18n" ? { type: "i18n" as const } : {}),
        ...(typeof label.zh_CN === "string" ? { zh_CN: label.zh_CN } : {}),
        ...(typeof label.en_US === "string" ? { en_US: label.en_US } : {}),
      };
    }
  }
  return "";
}
