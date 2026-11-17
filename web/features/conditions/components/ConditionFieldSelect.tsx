"use client";

import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { FieldSelect } from "@/features/form-controls/components/FieldSelect";
import { loadConditionSchema } from "../api";
import type { RuntimeSchemaField } from "@/features/form-model/runtime-types";
import { conditionRoot, readConditionPath, writeConditionPath, type SourceFieldChoice } from "../index";

function conditionFields(fields: RuntimeSchemaField[]) {
  return fields.filter(field => {
    if (["subform", "groupContainer", "separator", "description", "button", "html", "tsx"].includes(field.type)) return false;
    const seen = new Set<string>();
    let parent = field.parentGroupId;
    while (parent) {
      if (seen.has(parent)) return false;
      seen.add(parent);
      const container = fields.find(item => item.id === parent);
      if (!container || container.type === "subform") return false;
      parent = container.parentGroupId;
    }
    return true;
  });
}

export async function resolveConditionChoices(roots: SourceFieldChoice[], key: string, signal?: AbortSignal) {
  const ref = readConditionPath(key);
  let current = roots.find(field => field.key === ref.root);
  let choices = roots;
  let label = current?.label ?? "字段已失效";
  for (let i = 0; i < ref.path.length; i++) {
    if (signal?.aborted) throw new Error("aborted");
    if (current?.fieldType !== "associationFormField" || !current.props?.associationFormId) throw new Error("关联路径已失效");
    const schema = await loadConditionSchema(current.props.associationFormId);
    choices = conditionFields(schema.fields).map(field => ({
      key: writeConditionPath({ root: ref.root, path: [...ref.path.slice(0, i), field.id] }),
      label: `${label} / ${field.label}`, fieldType: field.type, props: field.props,
      options: (field.props?.options ?? []).map(option => typeof option === "string" ? { label: option, value: option } : option),
    }));
    current = choices.find(field => field.key === writeConditionPath({ root: ref.root, path: ref.path.slice(0, i + 1) }));
    if (!current) throw new Error("关联字段已删除或目标表单已改变");
    label = current.label;
  }
  return { current, choices };
}

export function useConditionField(roots: SourceFieldChoice[], key: string) {
  const [resolved, setResolved] = useState<{ key: string; field?: SourceFieldChoice }>({ key: "" });
  const direct = roots.find(field => field.key === key);
  useEffect(() => {
    if (!key || direct) return;
    const controller = new AbortController();
    void resolveConditionChoices(roots, key, controller.signal).then(result => {
      if (!controller.signal.aborted) setResolved({ key, field: result.current });
    }).catch(() => { if (!controller.signal.aborted) setResolved({ key }); });
    return () => controller.abort();
  }, [roots, key, direct]);
  return direct ?? (resolved.key === key ? resolved.field : undefined);
}

export function ConditionFieldSelect({ options, value, onChange, ariaLabel = "来源字段", compatible }: {
  options: SourceFieldChoice[]; value: string; onChange: (key: string, field?: SourceFieldChoice) => void; ariaLabel?: string; compatible?: (field: SourceFieldChoice) => boolean;
}) {
  const field = useConditionField(options, value);
  const [level, setLevel] = useState<{ parent: string; choices: SourceFieldChoice[] }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const ref = readConditionPath(value);
  const displayOptions = level?.parent === value ? level.choices : field && !options.some(item => item.key === value) ? [...options, field] : options;
  async function expand() {
    if (!field?.props?.associationFormId) return;
    setLoading(true); setError("");
    try {
      const schema = await loadConditionSchema(field.props.associationFormId);
      const choices = conditionFields(schema.fields).map(item => ({
        key: writeConditionPath({ root: conditionRoot(value), path: [...ref.path, item.id] }),
        label: `${field.label} / ${item.label}`, fieldType: item.type, props: item.props,
        options: (item.props?.options ?? []).map(option => typeof option === "string" ? { label: option, value: option } : option),
      }));
      setLevel({ parent: value, choices: [field, ...choices] });
    } catch { setError("关联表单字段加载失败，请重试"); }
    finally { setLoading(false); }
  }
  return <div className="min-w-0 space-y-1">
    <FieldSelect options={displayOptions.filter(item => !compatible || compatible(item) || item.fieldType === "associationFormField" || item.key === value)} value={value} onChange={key => { onChange(key, displayOptions.find(item => item.key === key)); setLevel(undefined); }} ariaLabel={ariaLabel} placeholder={value && !field ? "路径加载中或已失效" : "选择字段"} />
    {field?.fieldType === "associationFormField" && ref.path.length < 8 ? <Button size="sm" variant="ghost" isDisabled={loading} onPress={() => void expand()}>{loading ? "加载中…" : "选择关联表单中的字段"}</Button> : null}
    {ref.path.length ? <Button size="sm" variant="ghost" onPress={() => { onChange(writeConditionPath({ root: ref.root, path: ref.path.slice(0, -1) })); setLevel(undefined); }}>返回上一级</Button> : null}
    {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
  </div>;
}

