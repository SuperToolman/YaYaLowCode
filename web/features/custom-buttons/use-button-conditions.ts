"use client";
import { useCallback, useEffect, useState } from "react";
import { evaluateConditions } from "@/features/conditions/api";
import { readConditionPath } from "@/features/conditions";
import type { FormRecord } from "@/features/records/types";
import type { ButtonDefinition } from "./model";

export const hasRelatedConditions = (button: Pick<ButtonDefinition, "availability">) => button.availability.mode === "conditions" && button.availability.rules.some(rule => [rule.fieldKey, rule.sourceFieldKey].some(key => !!key && readConditionPath(key).path.length > 0));
export function useButtonConditions(formUuid: string, buttons: ButtonDefinition[], records: FormRecord[]) {
  const [result, setResult] = useState<{ signature: string; matches: Map<string, Set<string>> }>({ signature: "", matches: new Map() });
  const signature = JSON.stringify([formUuid, buttons.filter(hasRelatedConditions).map(button => [button.id, button.availability]), records]);
  useEffect(() => {
    let active = true;
    const [form, definitions, rows] = JSON.parse(signature) as [string, [string, ButtonDefinition["availability"]][], FormRecord[]];
    if (!definitions.length) return;
    void Promise.all(definitions.map(async ([id, availability]) => {
      const matches = await evaluateConditions(form, availability.rules, rows.map(record => ({ instanceId: record.id, submitter: record.createdBy, submitterOrganization: record.submitterOrganization, createdAt: record.createdAt, updatedAt: record.updatedAt, ...record.data })));
      return [id, new Set(rows.filter((_,index) => matches[index]).map(record => record.id))] as const;
    })).then(items => { if (active) setResult({ signature, matches: new Map(items) }); }).catch(() => { if (active) setResult({ signature, matches: new Map() }); });
    return () => { active = false; };
  }, [signature]);
  return useCallback((buttonId: string, recordId: string) => result.signature === signature && !!result.matches.get(buttonId)?.has(recordId), [result, signature]);
}
