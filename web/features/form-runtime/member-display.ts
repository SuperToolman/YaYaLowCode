import type { IdentityUser } from "./types";
import type { RuntimeFieldProps } from "../form-model/runtime-types";

export function getMemberLabel(
  user: IdentityUser,
  displayFormat: RuntimeFieldProps["memberDisplayFormat"] = "name",
) {
  if (displayFormat === "nameJobNumber") return `${user.displayName}(${user.jobNumber || "-"})`;
  if (displayFormat === "nameUserId") return `${user.displayName}(${user.id})`;
  return user.displayName;
}

export function formatMemberValue(
  value: unknown,
  users: ReadonlyMap<string, IdentityUser>,
  displayFormat?: RuntimeFieldProps["memberDisplayFormat"],
) {
  const ids = Array.isArray(value) ? value : [value];
  return ids.flatMap((id) => {
    if (typeof id !== "string" || !id.trim()) return [];
    const user = users.get(id);
    return [user ? getMemberLabel(user, displayFormat) : id];
  }).join("、") || "-";
}
