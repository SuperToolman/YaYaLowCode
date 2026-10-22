import type { FlowState } from "./automation-editor-model";

export function automationSaveMetadata(flow: FlowState, fallbackName: string) {
  return {
    ...(flow.flowType === "process" ? {} : { name: flow.name.trim() || fallbackName }),
    description: flow.description.trim() || undefined,
    status: flow.status,
    triggerFormUuid: flow.triggerFormUuid || undefined,
    triggerEvents: flow.triggerEvents,
    triggerConfig: flow.triggerConfig,
  };
}

export function automationSaveErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error &&
      typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) return error;
  return "保存自动化编排失败，请稍后重试。";
}
