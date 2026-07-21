export const APP_NAVIGATION_CHANGED_EVENT = "app-navigation-changed";

export type AppNavigationChangedDetail = {
  appId: string;
};

export function notifyAppNavigationChanged(appId: string) {
  window.dispatchEvent(
    new CustomEvent<AppNavigationChangedDetail>(APP_NAVIGATION_CHANGED_EVENT, {
      detail: { appId },
    }),
  );
}
