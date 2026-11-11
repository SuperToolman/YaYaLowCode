
"use client";
import { PropertyButton } from "../property-panel/PropertyControls";

import { Modal } from "@heroui/react";
import { useEffect, useState } from "react";
import { BranchRulesEditor } from "@/features/conditions/components/BranchRulesEditor";
import { getFormSchema } from "@/features/form-designer";
import { addRule, removeRuleTree, updateRule, validateRuleTree, type BranchRule, type SourceFieldChoice } from "@/features/conditions";
import type { FieldPropsChangeHandler, PlacedField } from "../../designer-types";
import { DefaultValueTypeSegmented } from "./DefaultValueTypeSegmented";

export function AssociationDefaultValueEditor({ field, onPropsChange }: {
  field: PlacedField;
  onPropsChange: FieldPropsChangeHandler;
}) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<SourceFieldChoice[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [rules, setRules] = useState<BranchRule[]>([]);
  const formId = field.props.associationFormId;

  useEffect(() => {
    if (!formId || !open) return;
    let cancelled = false;
    void getFormSchema({ path: { formUuid: formId }, responseStyle: "fields" })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || data?.code !== 0) throw new Error("无法加载关联表单字段");
        const schema = data.data?.schema as { fields?: PlacedField[] } | undefined;
        setChoices((schema?.fields ?? []).filter(item => !item.parentGroupId && !["groupContainer", "separator", "subform", "description", "button", "html", "tsx"].includes(item.type)).map(item => ({ key: item.id, label: item.label, fieldType: item.type, options: (item.props.options ?? []).map(option => typeof option === "string" ? { label: option, value: option } : option) })));
        setStatus("ready");
      }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [formId, open]);

  const validation = rules.length ? validateRuleTree(rules, new Set(choices.map(item => item.key))) || rules.some(rule => rule.valueType === "field" && !choices.some(item => item.key === rule.sourceFieldKey)) && "请选择有效的比较字段" : undefined;
  const save = () => {
    onPropsChange(field.id, { associationDefaultRules: rules, defaultValueType: "filter", defaultValue: "", defaultValueFormula: "", defaultValueLinkage: "" });
    setOpen(false);
  };

  const openEditor = () => {
    if (!formId) return;
    setStatus("loading");
    setRules(structuredClone(field.props.associationDefaultRules ?? []));
    setOpen(true);
  };
  const mode = field.props.defaultValueType === "filter" ? "filter" : "none";
  return <>
    <div className="w-full min-w-0 flex-1 space-y-1 overflow-hidden">
      <DefaultValueTypeSegmented
        options={["none", "filter"]}
        disabledOptions={!formId ? ["filter"] : []}
        value={mode}
        onChange={(defaultValueType) => onPropsChange(field.id, { defaultValueType })}
      />
      {mode === "filter" ? (
        <PropertyButton variant="secondary" fullWidth isDisabled={!formId} onPress={openEditor}>
          {field.props.associationDefaultRules?.length ? "已设置" : "设置筛选条件"}
        </PropertyButton>
      ) : null}
    </div>
    <Modal isOpen={open} onOpenChange={setOpen}>
      <Modal.Backdrop><Modal.Container placement="center" size="lg">
        <Modal.Dialog className="flex max-h-[86vh] w-[min(920px,96vw)] flex-col overflow-hidden">
          <Modal.Header><Modal.Heading>默认值筛选</Modal.Heading><Modal.CloseTrigger aria-label="关闭" /></Modal.Header>
          <Modal.Body className="space-y-3 overflow-y-auto">
            <p className="text-sm text-[var(--color-text-secondary)]">从关联表单中筛选默认记录。多条匹配时选择创建时间最新的可选记录；清空条件表示不设置默认值。</p>
            {status === "loading" ? <p>正在加载关联表单字段…</p> : status === "error" ? <p role="alert">关联表单字段加载失败，请关闭后重试。</p> : <BranchRulesEditor rules={rules} sourceFieldChoices={choices} onAddConditionRule={(parentId, siblingOfId, count) => setRules(current => addRule(current, parentId, siblingOfId, count))} onConditionRuleChange={(id, key, value) => setRules(current => updateRule(current, id, key, value))} onRemoveConditionRule={id => setRules(current => removeRuleTree(current, id))} />}
            {validation ? <p role="alert" className="text-sm text-danger">{validation}</p> : null}
          </Modal.Body>
          <Modal.Footer><PropertyButton variant="secondary" onPress={() => setOpen(false)}>取消</PropertyButton><PropertyButton isDisabled={status !== "ready" || Boolean(validation)} onPress={save}>确定</PropertyButton></Modal.Footer>
        </Modal.Dialog>
      </Modal.Container></Modal.Backdrop>
    </Modal>
  </>;
}
