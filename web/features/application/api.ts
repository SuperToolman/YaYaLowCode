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
} from "@/shared/lib/http";
import * as sdk from "@/shared/lib/http";
import { fetchWithControl, normalizeApiError, unwrapApiResult } from "@/shared/lib/api-request";

// Packaging rechecks every dependency before generating a ZIP; use the same
// bounded wait on the browser and BFF instead of the ordinary 15-second limit.
const publicationFetch: typeof fetch = (input, init) => fetchWithControl(input, { ...init, timeoutMs: 120_000, bufferResponse: true });

export type SubmissionRecord = sdk.MarketSubmission & { listingStatus?: string };
export type SubmissionHistory = { records: SubmissionRecord[]; syncError?: string | null };
export async function listMarketSubmissionRecords() { return unwrapApiResult(await sdk.listMarketSubmissionRecords({ fetch: publicationFetch })) as SubmissionHistory; }
export async function retryMarketSubmission(id: string) { return unwrapApiResult(await sdk.retryMarketSubmission({ path: { id }, fetch: publicationFetch })); }
export async function syncMarketplaceApplications() { return unwrapApiResult(await sdk.syncMarketApplications()); }
export async function getMarketPublicationCapabilities() { return unwrapApiResult(await sdk.getMarketPublicationCapabilities()); }
export type PublicationPreflight = { selectedAppIds?: string[]; fingerprint: string; applicationType: "single" | "suite"; members: { appId: string; name: string }[]; dependencies: { sourceAppId: string; targetAppId: string; resourceId: string; path: string }[]; resourceSummary: Record<string, number>; blockingIssues: { appId: string; path: string; message: string; location?: string; suggestion?: string; resourceId?: string; previousPath?: string }[]; configurationRequired: string[] };
export async function preflightMarketPublication(appId: string, selectedAppIds: string[] = [appId]) { return unwrapApiResult(await sdk.preflightMarketPublication({ path: { appId }, body: { selectedAppIds }, fetch: publicationFetch })) as PublicationPreflight; }
export async function getMarketplaceSubmission(appId: string) { return unwrapApiResult(await sdk.getMarketSubmission({ path: { appId } })); }
export async function submitAppToMarketplace(appId: string, body: sdk.PublishRequest) { return unwrapApiResult(await sdk.submitMarketApplication({ path: { appId }, body, fetch: publicationFetch })); }
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
export type { App } from "@/shared/lib/http";

export async function exportApplicationPackage(appId: string, fingerprint: string, version: string, packageName?: string, selectedAppIds: string[] = [appId], publication?: { submissionType: "new_listing" | "version_upgrade"; targetProductId?: string }) {
  const result = await sdk.exportMarketPackage({ path: { appId }, body: { fingerprint, version, packageName, selectedAppIds, ...publication }, fetch: publicationFetch, parseAs: "blob", responseStyle: "fields" });
  if (result.error || !(result.data instanceof Blob)) {
    if (result.error) throw normalizeApiError(result.error, result.response);
    throw new Error("应用包导出失败，请重新预检后重试");
  }
  const disposition = result.response?.headers.get("content-disposition") ?? "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const filename = encodedName ? decodeURIComponent(encodedName) : `application-${version}.zip`;
  const file = { filename, blob: result.data, size: result.data.size };
  downloadApplicationPackage(file);
  return file;
}

export type ExportedApplicationPackage = { filename: string; blob: Blob; size: number };

export function downloadApplicationPackage(file: ExportedApplicationPackage) {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement("a");
  link.href = url; link.download = file.filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ApplicationOrder = sdk.ApplicationOrder;
export type ApplicationRevenue = sdk.ApplicationRevenue;
export async function checkoutApplication(productId: string, commercialId: string, idempotencyKey: string) { return unwrapApiResult(await sdk.applicationCheckout({ path: { productId }, body: { commercialId, idempotencyKey } })); }
export async function listApplicationOrders() { return unwrapApiResult(await sdk.applicationOrders()); }
export async function listApplicationRevenues() { return unwrapApiResult(await sdk.applicationRevenues()); }
export async function simulateApplicationPayment(orderId: string) { return unwrapApiResult(await sdk.applicationSimulatePayment({ path: { orderId }, body: {} })); }
export async function applicationOrderAction(orderId: string, action: "cancel" | "refund", reason?: string) { return unwrapApiResult(await sdk.applicationOrderAction({ path: { orderId }, body: { action, reason } })); }

export async function listCommercialVersions(productId:string){return unwrapApiResult(await sdk.applicationCommercialVersions({path:{productId}}));}
export async function submitCommercialVersion(productId:string,body:sdk.CommercialSubmission){return unwrapApiResult(await sdk.applicationSubmitCommercial({path:{productId},body}));}
