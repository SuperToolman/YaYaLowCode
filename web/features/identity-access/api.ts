export {
  createLocalRole,
  createLocalOrganizationUnit,
  createLocalUser,
  createProvider,
  deleteLocalRole,
  deleteProvider,
  deleteUser,
  getRolePermissions,
  initializeLocalCredentials,
  listOrganizationUnits,
  listProviders,
  listRoles,
  listUsers,
  updateLocalRole,
  updateProvider,
  updateRolePermissions,
  updateUser,
} from "@/app/lib/api-client";

export type { UpdateUserRequest, UserResponse } from "@/app/lib/api-client";

export type CredentialInitializationResult = { initialized: number; alreadyConfigured: number; skipped: Array<{ userId: string; displayName: string; reason: string }> };

export async function initializeUserCredentials(): Promise<CredentialInitializationResult> {
  const result = await import("@/app/lib/api-client").then(({ initializeLocalCredentials }) => initializeLocalCredentials({ responseStyle: "fields" }));
  if (result.error || result.data?.code !== 0 || !result.data.data) throw new Error(result.data?.message || "初始化账号密码失败");
  return result.data.data as CredentialInitializationResult;
}
