import type { RuntimeFieldOption, RuntimeFieldProps, RuntimeFieldType } from "../../form-model/runtime-types";

export const DEFAULT_COLUMN_GAP = 16;

export const DEFAULT_ROW_GAP = 20;

export const DEFAULT_OPTIONS: RuntimeFieldOption[] = [
  { label: "选项一", value: "选项一" },
  { label: "选项二", value: "选项二" },
];

export const DEFAULT_DEPARTMENT_OPTIONS: RuntimeFieldOption[] = [
  { label: "产品部", value: "product" },
  { label: "研发部", value: "engineering" },
  { label: "运营部", value: "operations" },
];

export function normalizeFieldOptions(
  options?: RuntimeFieldOption[],
  type?: RuntimeFieldType,
): RuntimeFieldOption[] {
  if (options && options.length > 0) {
    return options;
  }

  if (type === "member") {
    return DEFAULT_OPTIONS;
  }

  if (type === "department") {
    return DEFAULT_DEPARTMENT_OPTIONS;
  }

  return DEFAULT_OPTIONS;
}

export function isTopAlignedRuntimeField(type: RuntimeFieldType) {
  return (
    type === "groupContainer" ||
    type === "separator" ||
    type === "description" ||
    type === "multiLineText" ||
    type === "richText" ||
    type === "html" ||
    type === "tsx" ||
    type === "radio" ||
    type === "checkbox" ||
    type === "attachment" ||
    type === "imageUpload" ||
    type === "subform"
  );
}

export function getRuntimeTitlePosition(
  type: RuntimeFieldType,
  position: RuntimeFieldProps["titlePosition"],
) {
  if (position === "inside" && type !== "singleLineText") {
    return "top";
  }

  return position ?? "top";
}
