export const groupTitleTypeOptions = [
  { value: "h1", label: "H1" },
  { value: "h2", label: "H2" },
  { value: "h3", label: "H3" },
  { value: "h4", label: "H4" },
  { value: "h5", label: "H5" },
  { value: "h6", label: "H6" },
  { value: "body", label: "正文" },
  { value: "body-sm", label: "小号正文" },
  { value: "body-xs", label: "超小正文" },
  { value: "code", label: "代码" },
] as const;

export type GroupTitleType = (typeof groupTitleTypeOptions)[number]["value"];

export const groupStyleOptions = [
  { value: "simple", label: "简约" },
  { value: "surface", label: "Surface" },
  { value: "bordered", label: "边框" },
  { value: "divider", label: "分割线" },
] as const;

export type GroupStyle = (typeof groupStyleOptions)[number]["value"];

export const separatorOrientationOptions = [
  { value: "horizontal", label: "横向" },
  { value: "vertical", label: "纵向" },
] as const;

export const separatorStyleOptions = [
  { value: "solid", label: "实线" },
  { value: "dashed", label: "虚线" },
  { value: "dotted", label: "点线" },
] as const;

export const separatorVariantOptions = [
  { value: "default", label: "默认" },
  { value: "secondary", label: "次级" },
  { value: "tertiary", label: "三级" },
] as const;

export type SeparatorStyle = (typeof separatorStyleOptions)[number]["value"];
export type SeparatorVariant = (typeof separatorVariantOptions)[number]["value"];
export type SeparatorOrientation = (typeof separatorOrientationOptions)[number]["value"];
