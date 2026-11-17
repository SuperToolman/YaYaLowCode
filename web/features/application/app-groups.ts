import type { AppItem } from "./types";

export function groupApplications(apps: AppItem[]) {
  const local: AppItem[] = [];
  const purchased: AppItem[] = [];
  const suites = new Map<string, { id: string; name: string; apps: AppItem[] }>();

  for (const app of apps) {
    if (app.deploymentType !== "online") {
      local.push(app);
      continue;
    }
    if (app.marketInstallationId && app.marketApplicationType === "suite") {
      const id = app.marketInstallationId;
      const group = suites.get(id) ?? {
        id,
        name: app.marketProductName || "已购套应用",
        apps: [],
      };
      group.apps.push(app);
      suites.set(id, group);
    } else {
      purchased.push(app);
    }
  }

  return { local, purchased, suites: [...suites.values()] };
}
