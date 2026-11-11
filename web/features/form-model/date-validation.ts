import { parseDate, today } from "@internationalized/date";

export type DateValidation = "none" | "beforeToday" | "onOrBeforeToday" | "onOrAfterToday" | "afterToday";

export const dateValidationOptions: readonly { value: DateValidation; label: string }[] = [
  { value: "none", label: "不限制" },
  { value: "beforeToday", label: "今天之前" },
  { value: "onOrBeforeToday", label: "今天及之前" },
  { value: "onOrAfterToday", label: "今天及之后" },
  { value: "afterToday", label: "今天之后" },
];

export function getDateValidation(props: { dateValidation?: DateValidation; dateTodayOrFuture?: boolean }): DateValidation {
  return props.dateValidation ?? (props.dateTodayOrFuture ? "onOrAfterToday" : "none");
}

export function getDateBounds(rule: DateValidation) {
  const current = today("Asia/Shanghai");
  return {
    minValue: rule === "afterToday" ? current.add({ days: 1 }) : rule === "onOrAfterToday" ? current : undefined,
    maxValue: rule === "beforeToday" ? current.subtract({ days: 1 }) : rule === "onOrBeforeToday" ? current : undefined,
  };
}

export function getDateValidationError(rule: DateValidation, values: unknown[]): string | undefined {
  if (rule === "none") return;
  const { minValue, maxValue } = getDateBounds(rule);
  try {
    for (const value of values) {
      if (typeof value !== "string") return "请输入有效日期";
      const date = parseDate(value.slice(0, 10));
      if ((minValue && date.compare(minValue) < 0) || (maxValue && date.compare(maxValue) > 0)) {
        return `日期必须是${dateValidationOptions.find((option) => option.value === rule)?.label}`;
      }
    }
  } catch {
    return "请输入有效日期";
  }
}
