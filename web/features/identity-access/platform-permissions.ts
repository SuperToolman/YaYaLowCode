import catalog from "./platform-permissions.json";

export const platformPermissionGroups = catalog.groups;
const permissionKeys = new Set(catalog.groups.flatMap((group) => group.items.map((item) => item.key)));
const legacyPermissions: Record<string, string[]> = catalog.legacy;

export function normalizePlatformGrants(grants: readonly string[]) {
  const result = new Set<string>();
  for (const grant of grants) {
    for (const permission of Object.hasOwn(legacyPermissions, grant) ? legacyPermissions[grant] : [grant])
      result.add(permission);
  }
  return [...result];
}

export function effectivePlatformGrants(grants: readonly string[]) {
  const result = new Set(normalizePlatformGrants(grants));
  for (const grant of result) {
    const view = grant.replace(/\.manage$/, ".view");
    if (grant.endsWith(".manage") && permissionKeys.has(view)) result.add(view);
  }
  return result;
}

export function canAccessPlatform(
  grants: readonly string[],
  permission: string,
) {
  const effective = effectivePlatformGrants(grants);
  return effective.has("*") || effective.has(permission);
}

export function settingsPagePermission(pathname: string): string | null {
  const routes: Record<string, string> = {
    database: "settings.database.view",
    logs: "settings.logs.view",
    notifications: "settings.notifications.view",
    communication: "settings.communication.view",
    "identity-source": "settings.identity-source.view",
    organization: "settings.identity-source.view",
    users: "settings.users.view",
    roles: "settings.roles.view",
    permissions: "settings.permissions.view",
    "model-providers": "settings.models.view",
    "agent-archive": "settings.agent-archive.view",
    "ai-employee-market": "settings.ai-employees.view",
  };
  return routes[pathname.split("/")[2]] ?? null;
}
