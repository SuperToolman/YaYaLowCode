import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import catalog from "./platform-permissions.json";
import { canAccessPlatform, effectivePlatformGrants, normalizePlatformGrants, settingsPagePermission } from "./platform-permissions";

describe("platform RBAC", () => {
  it("keeps the API and permission editor catalogs identical", () => {
    const api = JSON.parse(readFileSync("../api/src/platform/platform-permissions.json", "utf8"));
    expect(api).toEqual(catalog);
    const keys = catalog.groups.flatMap(group => group.items.map(item => item.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("management includes viewing without crossing feature boundaries", () => {
    expect(canAccessPlatform(["settings.database.manage"], "settings.database.view")).toBe(true);
    expect(canAccessPlatform(["settings.database.view"], "settings.database.manage")).toBe(false);
    expect(canAccessPlatform(["settings.database.manage"], "settings.logs.view")).toBe(false);
    expect(effectivePlatformGrants(["settings.license.manage"]).has("settings.license.view")).toBe(false);
    expect(canAccessPlatform(["*"], "settings.permissions.manage")).toBe(true);
  });
  it("expands old roles while preserving resource grants", () => {
    expect(normalizePlatformGrants(["settings.roles", "app:a:display", "agent:employee:use"])).toEqual([
      "settings.roles.manage", "settings.permissions.manage", "app:a:display", "agent:employee:use",
    ]);
    expect(canAccessPlatform(["settings.agent"], "settings.models.view")).toBe(true);
    expect(canAccessPlatform(["settings.agent"], "settings.database.view")).toBe(false);
    expect(canAccessPlatform(["apps.import"], "market.apps.manage")).toBe(true);
    expect(canAccessPlatform(["agent.window"], "agent:employee:use")).toBe(false);
  });
  it("gates direct settings URLs with the same viewing permissions", () => {
    expect(settingsPagePermission("/settings/database")).toBe("settings.database.view");
    expect(settingsPagePermission("/settings/permissions/nested")).toBe("settings.permissions.view");
    expect(settingsPagePermission("/settings/ai-employee-market")).toBe("settings.ai-employees.view");
    expect(settingsPagePermission("/settings/model-providers")).toBe("settings.models.view");
    expect(settingsPagePermission("/settings/theme")).toBeNull();
    expect(settingsPagePermission("/settings/about")).toBeNull();
  });
});
