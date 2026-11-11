import { unwrapApiResult } from "@/shared/lib/api-request";
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
} from "@/shared/lib/http";

export type {
  CreateLocalUserRequest,
  UpdateUserRequest,
  UserResponse,
} from "@/shared/lib/http";

export type CredentialInitializationResult = import("@/shared/lib/http").InitializeLocalCredentialsResponse;

export async function initializeUserCredentials(): Promise<CredentialInitializationResult> {
  const result = await import("@/shared/lib/http").then(
    ({ initializeLocalCredentials }) =>
      initializeLocalCredentials({ responseStyle: "fields" }),
  );
  return unwrapApiResult(result);
}
