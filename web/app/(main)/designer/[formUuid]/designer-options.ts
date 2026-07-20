import type {
  DesignerComponentType,
  DesignerFieldOption,
} from "./components/CompTool";

export function parseOptionalNumber(value: string) {
  if (value.trim() === "") {
    return undefined;
  }

  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : undefined;
}

export function toOptionalNumber(
  value: string | number | string[] | undefined,
) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return parseOptionalNumber(value);
  }

  return undefined;
}

export function createOptionsFromText(value: string): DesignerFieldOption[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separatorIndex = item.indexOf("|");

      if (separatorIndex < 0) {
        return {
          label: item,
          value: item,
        };
      }

      const label = item.slice(0, separatorIndex).trim();
      const optionValue = item.slice(separatorIndex + 1).trim();

      return {
        label,
        value: optionValue || label,
      };
    })
    .filter((option) => option.label);
}

export function serializeOptions(options: DesignerFieldOption[]) {
  return options
    .map((option) =>
      option.label === option.value
        ? option.label
        : `${option.label}|${option.value}`,
    )
    .join("\n");
}

export function isChoiceFieldType(type: DesignerComponentType) {
  return (
    type === "radio" ||
    type === "checkbox" ||
    type === "select" ||
    type === "multiSelect" ||
    type === "member" ||
    type === "department"
  );
}
