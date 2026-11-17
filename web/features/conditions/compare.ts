import { decodeConditionValue, type ConditionValue } from "./value";

export const conditionHasValue = (value: unknown): boolean => value != null && (typeof value === "string" ? !!value.trim() : Array.isArray(value) ? value.length > 0 : typeof value === "object" ? Object.keys(value).length > 0 : true);
const scalar = (value: unknown): string => value == null ? "" : typeof value === "string" ? value.trim() : typeof value === "object" ? JSON.stringify(value) : String(value);
export function compareCondition(actual: unknown, operator: string, expected: ConditionValue): boolean {
  const date = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return NaN;
    const text = value.split("[")[0];
    return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(text) ? text : text + "Z");
  };
  const equal = (a: unknown, b: unknown): boolean => typeof a === "number" || typeof b === "number" ? a != null && a !== "" && b != null && b !== "" && Number.isFinite(Number(a)) && Number(a) === Number(b) : Number.isFinite(date(a)) && Number.isFinite(date(b)) ? date(a) === date(b) : scalar(a) === scalar(b);
  const list = Array.isArray(expected) ? expected : String(expected ?? "").split(",").map(item => item.trim()).filter(Boolean);
  const items = Array.isArray(actual) ? actual : actual == null ? [] : [actual];
  const order = (a: unknown, b: unknown): number | null => {
    if (typeof a === "number" || typeof b === "number") { const n = Number(a), m = Number(b); return a == null || a === "" || b == null || b === "" || !Number.isFinite(n) || !Number.isFinite(m) ? null : n - m; }
    if (Number.isFinite(date(a)) && Number.isFinite(date(b))) return date(a) - date(b);
    const left = scalar(a), right = scalar(b);
    return !left || !right ? null : left < right ? -1 : left > right ? 1 : 0;
  };
  switch (operator) {
    case "hasValue": return conditionHasValue(actual);
    case "noValue": return !conditionHasValue(actual);
    case "eq": return actual != null && equal(actual, expected);
    case "neq": return actual == null || !equal(actual, expected);
    case "inAny": return actual != null && list.some(value => equal(actual, value));
    case "notInAny": return actual == null || !list.some(value => equal(actual, value));
    case "contains": return actual != null && scalar(actual).includes(scalar(expected));
    case "notContains": return actual == null || !scalar(actual).includes(scalar(expected));
    case "containsAny": return items.some(item => list.some(value => equal(item, value)));
    case "containsAll": return list.length > 0 && list.every(value => items.some(item => equal(item, value)));
    case "containsNone": return !items.some(item => list.some(value => equal(item, value)));
    case "gt": { const n = order(actual, expected); return n !== null && n > 0; }
    case "gte": { const n = order(actual, expected); return n !== null && n >= 0; }
    case "lt": { const n = order(actual, expected); return n !== null && n < 0; }
    case "lte": { const n = order(actual, expected); return n !== null && n <= 0; }
    case "between": { const lower = order(actual, list[0]), upper = order(actual, list[1]); return list.length === 2 && lower !== null && upper !== null && lower >= 0 && upper <= 0; }
    default: return false;
  }
}
export { decodeConditionValue };
