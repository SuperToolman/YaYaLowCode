import { unwrapApiResult } from "@lib/api-request";
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
} from "@/app/lib/http";

export type {
  CreateLocalUserRequest,
  UpdateUserRequest,
  UserResponse,
} from "@/app/lib/http";

export type CredentialInitializationResult = import("@lib/http").InitializeLocalCredentialsResponse;

export async function initializeUserCredentials(): Promise<CredentialInitializationResult> {
  const result = await import("@/app/lib/http").then(
    ({ initializeLocalCredentials }) =>
      initializeLocalCredentials({ responseStyle: "fields" }),
  );
  return unwrapApiResult(result);
}
