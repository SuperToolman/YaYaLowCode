import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const modelPath = resolve(directory, "../app/(main)/[appId]/automations/[automationId]/automation-editor-model.ts");
const componentsPath = resolve(directory, "../app/(main)/[appId]/automations/[automationId]/automation-node-editor-components.tsx");

let model = await readFile(modelPath, "utf8");
model = model.replace(/^type /gm, "export type ");
model = model.replace(/^function /gm, "export function ");
model = model.replace(/^const /gm, "export const ");
model = model.replace('import type { ApiFormSummary } from "../../../../lib/api-client";', 'import type { ApiDetailForm, ApiFormSummary } from "../../../../lib/api-client";');
model = model.replace('import type { AutomationStatus, TriggerEvent } from "../automation-shared";', 'import { triggerEvents, type AutomationStatus, type TriggerEvent } from "../automation-shared";');
await writeFile(modelPath, model);

let components = await readFile(componentsPath, "utf8");
components = components.replace("function WorkflowCardNode(", "export function WorkflowCardNode(");
components = components.replace("function InsertableEdge(", "export function InsertableEdge(");
components = components.replace("function NodeConfigFields(", "export function NodeConfigFields(");
components = components.replace("function PropertyPanelSection(", "export function PropertyPanelSection(");
components = components.replace("function PropertyField(", "export function PropertyField(");
components = components.replace('  normalizeGetDataConfig,', '  normalizeGetDataConfig,\n  normalizeTriggerConfig,\n  branchOperators,\n  defaultNodeTemplate,\n  extractExpressionTokens,\n  fieldTypeMatches,\n  valueTypeLabel,\n  workflowNodeWidth,');
components = components.replace('  type ActionConfig,', '  type ActionConfig,\n  type AddRecordMode,\n  type AddTargetMode,\n  type BranchRuleOperator,\n  type PaletteNodeKind,\n  type UpdateMode,');
await writeFile(componentsPath, components);
