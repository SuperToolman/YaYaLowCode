import { invalidateAppResources } from "@/features/application/resources";

export const APP_NAVIGATION_CHANGED_EVENT = "app-navigation-changed";

export type AppNavigationChangedDetail = {
  appId: string;
};

export function notifyAppNavigationChanged(appId: string) {
  // Invalidate before dispatch/navigation so remounted consumers cannot reuse old data.
  invalidateAppResources(appId, ["forms", "navigation"]);
  window.dispatchEvent(
    new CustomEvent<AppNavigationChangedDetail>(APP_NAVIGATION_CHANGED_EVENT, {
      detail: { appId },
    }),
  );
}
