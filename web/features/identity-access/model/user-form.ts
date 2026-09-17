import type { UpdateUserRequest, UserResponse } from "../api";

export type UserFormValues = { displayName: string; title: string; mobile: string; telephone: string; email: string; jobNumber: string; workPlace: string; remark: string; emailAddresses: Array<{ label: string; email: string }>; roleIds: string[] };
export function toUserFormValues(user: UserResponse): UserFormValues {
  return { displayName: user.displayName, title: user.title ?? "", mobile: user.mobile ?? "", telephone: user.telephone ?? "", email: user.email ?? "", jobNumber: user.jobNumber ?? "", workPlace: user.workPlace ?? "", remark: user.remark ?? "", emailAddresses: user.emailAddresses ?? [], roleIds: user.roleIds ?? [] };
}
export function validateUserForm(values: UserFormValues): string | null {
  if (!values.displayName.trim()) return "请填写姓名";
  if (values.emailAddresses.some((item) => !item.label.trim() || !item.email.trim())) return "请完整填写每个附加邮箱的名称和地址";
  return null;
}
export function toUpdateUserRequest(values: UserFormValues): UpdateUserRequest { return { ...values, displayName: values.displayName.trim(), roleIds: [...new Set(values.roleIds)] }; }
