import { listCustomButtons, createCustomButton, updateCustomButton, deleteCustomButton, getCustomButton } from "@/app/lib/http";
import type { ApiCustomButton, SaveCustomButtonRequest } from "@/app/lib/http";
import type { ButtonDefinition, ButtonDraft } from "./model";
import { unwrapApiResult as unwrap } from "@lib/api-request";
const definition = (data: ApiCustomButton): ButtonDefinition => ({
  ...data, availability: { mode: data.availability.mode === "conditions" ? "conditions" : "all", rules: (data.availability.rules ?? []).map((rule) => ({ id: rule.id, ...(rule.parentId ? { parentId: rule.parentId } : {}), ...(rule.isGroup != null ? { isGroup: rule.isGroup } : {}), ...(rule.logicalOperator === "or" || rule.logicalOperator === "and" ? { logicalOperator: rule.logicalOperator } : {}), ...(rule.fieldKey ? { fieldKey: rule.fieldKey } : {}), ...(rule.operator === "eq" || rule.operator === "neq" || rule.operator === "inAny" || rule.operator === "notInAny" || rule.operator === "hasValue" || rule.operator === "noValue" ? { operator: rule.operator } : {}), ...(rule.rawValue != null ? { rawValue: rule.rawValue } : {}), ...(rule.valueType === "field" || rule.valueType === "value" ? { valueType: rule.valueType } : {}), ...(rule.sourceFieldKey ? { sourceFieldKey: rule.sourceFieldKey } : {}) })) }, actionType: data.actionType === "run_automation" ? "run_automation" : data.actionType === "open_page" ? "open_page" : "fill_form", actionConfig: { targetAppId: "", targetFormUuid: "", fieldIds: [], ...data.actionConfig } as ButtonDraft["actionConfig"],
});
export async function getButtons(formUuid: string, search: string, page: number) { const data=unwrap(await listCustomButtons({path:{formUuid},query:{search,page,pageSize:20},responseStyle:"fields"}));return {...data,items:data.items.map(definition)}; }
export async function getButton(formUuid: string, buttonId: string) { return definition(unwrap(await getCustomButton({path:{formUuid,buttonId},responseStyle:"fields"}))); }
export async function saveButton(formUuid: string, buttonId: string | undefined, draft: ButtonDraft) {
  const body = { ...draft, actionConfig: draft.actionType === "run_automation" ? { automationId: draft.actionConfig.automationId } : draft.actionConfig, name: draft.name.trim(), description: draft.description.trim() } as SaveCustomButtonRequest;
  return definition(unwrap(await (buttonId ? updateCustomButton({path:{formUuid,buttonId},body,responseStyle:"fields"}) : createCustomButton({path:{formUuid},body,responseStyle:"fields"}))));
}
export async function removeButton(formUuid: string, buttonId: string) { unwrap(await deleteCustomButton({path:{formUuid,buttonId},responseStyle:"fields"})); }

import { listViewButtonOptions, listViewButtons, prepareViewButton, submitViewButton } from "@/app/lib/http";
const viewDefinition = definition;
export async function getBindingOptions(formUuid: string) { return unwrap(await listViewButtonOptions({ path: { formUuid }, responseStyle: "fields" })).map(viewDefinition); }
export async function getViewButtons(formUuid: string, viewUuid: string) { return unwrap(await listViewButtons({ path: { formUuid, viewUuid }, responseStyle: "fields" })).map(item => ({ binding: { buttonId: item.binding.buttonId }, definition: item.definition ? viewDefinition(item.definition) : null })); }
export async function prepareButton(formUuid: string, viewUuid: string, buttonUuid: string, recordId: string) { return viewDefinition(unwrap(await prepareViewButton({ path: { formUuid, viewUuid, buttonUuid }, body: { recordId }, responseStyle: "fields" }))); }
export async function submitButton(formUuid: string, viewUuid: string, buttonUuid: string, recordId: string, values: Record<string, unknown>) { return unwrap(await submitViewButton({ path: { formUuid, viewUuid, buttonUuid }, body: { recordId, data: values }, responseStyle: "fields" })); }

import { executeViewButton } from "@/app/lib/http";
export async function executeButton(formUuid: string, viewUuid: string, buttonUuid: string, recordId: string, requestId: string) {
  return unwrap(await executeViewButton({ path: { formUuid, viewUuid, buttonUuid }, body: { recordId, requestId }, responseStyle: "fields" }));
}
