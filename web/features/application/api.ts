export {
  createApp,
  createForm,
  createNavigationGroup,
  deleteApp,
  deleteForm,
  deleteNavigationGroup,
  listAppNavigation,
  listApps,
  moveFormNavigation,
  reorderNavigationItem,
  setDefaultNavigationEntry,
  updateApp,
  updateFormName,
  updateNavigationGroup,
} from "@/app/lib/http";
import * as sdk from "@lib/http";
import { unwrapApiResult } from "@lib/api-request";

export async function syncMarketplaceApplications() { return unwrapApiResult(await sdk.syncMarketApplications()); }
export async function submitAppToMarketplace(appId: string) { return unwrapApiResult(await sdk.submitMarketApplication({ path: { appId } })); }
export async function getMarketplaceApplication(productId: string) { return unwrapApiResult(await sdk.getMarketApplication({ path: { productId } })); }
export async function installMarketplaceApplication(productId: string) { return unwrapApiResult(await sdk.installMarketApplication({ path: { productId } })); }
export async function listMarketplaceApplications() { return unwrapApiResult(await sdk.listMarketApplications()); }
export async function preflightMarketplaceApplication(productId: string) { return unwrapApiResult(await sdk.preflightMarketApplication({ path: { productId } })); }
export async function listMarketplaceInstallations() { return unwrapApiResult(await sdk.listMarketInstallations()); }
export async function preflightMarketplaceInstallation(installationId: string) { return unwrapApiResult(await sdk.preflightMarketInstallation({ path: { installationId } })); }
export async function upgradeMarketplaceInstallation(installationId: string) { return unwrapApiResult(await sdk.upgradeMarketInstallation({ path: { installationId } })); }
export async function rollbackMarketplaceInstallation(installationId: string, releaseId: string) { return unwrapApiResult(await sdk.rollbackMarketInstallation({ path: { installationId }, body: { releaseId } })); }
export async function archiveMarketplaceInstallation(installationId: string) { return unwrapApiResult(await sdk.archiveMarketInstallation({ path: { installationId } })); }
export async function restoreMarketplaceInstallation(installationId: string) { return unwrapApiResult(await sdk.restoreMarketInstallation({ path: { installationId } })); }
export async function purgeMarketplaceInstallation(installationId: string) { return unwrapApiResult(await sdk.purgeMarketInstallation({ path: { installationId } })); }
export type { App } from "@lib/http";
