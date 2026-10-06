import { requestApi } from "./api-request";
import type {
  AutomationNodeManifest,
  ComponentManifest,
  PatchOperation,
  ValidationIssue,
} from "./agent-development-contracts";

type ContractEnvelope<T> = { code: number; data: T; message?: string };

export type DevelopmentCatalog = {
  components: Array<{ type: string; version: number; label: string; category: string; purpose: string; capabilities: string[] }>;
  automation: Array<{ kind: string; version: number; label: string; description: string; capabilities: string[] }>;
};

export function getDevelopmentCatalog() {
  return requestApi<ContractEnvelope<DevelopmentCatalog>>("/api/agent/development");
}

export function getComponentContract(type: string) {
  return requestApi<ContractEnvelope<ComponentManifest>>(`/api/agent/development?resource=component-contract&type=${encodeURIComponent(type)}`);
}

export function getAutomationNodeContract(kind: string) {
  return requestApi<ContractEnvelope<AutomationNodeManifest>>(`/api/agent/development?resource=automation-contract&type=${encodeURIComponent(kind)}`);
}

export function validateComponent(field: unknown) {
  return requestApi<ContractEnvelope<{ valid: boolean; issues: ValidationIssue[] }>>("/api/agent/development", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "validate-component", field }) });
}

export function validateAutomation(kind: string, config: unknown, context?: unknown) {
  return requestApi<ContractEnvelope<{ valid: boolean; issues: ValidationIssue[] }>>("/api/agent/development", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "validate-automation", kind, config, context }) });
}

export function previewDevelopmentPatch<T>(base: T, patch: PatchOperation[], baseVersion?: number) {
  return requestApi<ContractEnvelope<{ baseVersion: number | null; patch: PatchOperation[]; preview: T }>>("/api/agent/development", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "preview-patch", base, patch, baseVersion }) });
}
