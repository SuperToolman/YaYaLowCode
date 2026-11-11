import type { RuntimeFieldProps } from "../../form-model/runtime-types";

export function getMemberInitialValue(
  props: RuntimeFieldProps,
  { userId, initialValue, enabled = true }: { userId?: string; initialValue?: unknown; enabled?: boolean } = {},
): string | string[] {
  const ids = (value: unknown) => Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && Boolean(id))
    : typeof value === "string" && value ? [value] : [];
  const selected = initialValue !== undefined && initialValue !== null
    ? ids(initialValue)
    : !enabled ? []
    : props.defaultValueType === "currentUser" ? ids(userId)
    : props.defaultValueType === "custom" ? ids(props.defaultValue) : [];
  return props.memberMultiple ? selected : selected[0] ?? "";
}
