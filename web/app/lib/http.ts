// Stable application entry point. Generated output remains disposable.
export * from "./api-client";
export type { ApiApp as App, ApiAutomationFlow as AutomationFlow, ApiAutomationFlowList as AutomationFlowList, ApiFormSummary as FormSummary, ApiNavigationItem as NavigationItem } from "./api-client";
import { client } from "./api-client/client.gen";
import { normalizeApiError } from "./api-request";
client.interceptors.error.use((error, response) => normalizeApiError(error, response));
