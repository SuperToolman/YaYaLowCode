"use client";

import { useEffect, useState } from "react";
import { Button, Input, ListBox, NumberField, Select, TextArea } from "@heroui/react";
import { loadConditionRecord, loadConditionRecords, loadConditionMembers, loadConditionDepartments } from "../api";
import { ConditionDateValue } from "./ConditionDateValue";
import { dateTypes, decodeConditionValue, encodeConditionValue, numericTypes, type BranchRuleOperator, type ConditionValue, type SourceFieldChoice } from "../index";

function ChoiceValue({ choices, value, multiple, onChange, loading = false }: {
  choices: { label: string; value: string }[]; value: ConditionValue; multiple: boolean; onChange: (value: ConditionValue) => void; loading?: boolean;
}) {
  const selected = Array.isArray(value) ? value.map(String) : value === "" || value === null ? [] : [String(value)];
  const all = [...choices, ...selected.filter(id => !choices.some(item => item.value === id)).map(id => ({ label: `已选：${id}`, value: id }))];
  return <Select aria-label="匹配值" selectionMode={multiple ? "multiple" : "single"} value={multiple ? selected : selected[0] ?? null} onChange={key => { const next = Array.isArray(key) ? key.map(String) : key == null ? [] : [String(key)]; onChange(multiple ? next : next[0] ?? ""); }}>
    <Select.Trigger><Select.Value>{selected.length ? all.filter(item => selected.includes(item.value)).map(item => item.label).join("、") : loading ? "加载中…" : "请选择"}</Select.Value><Select.Indicator /></Select.Trigger>
    <Select.Popover><ListBox>{all.map(item => <ListBox.Item key={item.value} id={item.value} textValue={item.label}>{item.label}</ListBox.Item>)}</ListBox></Select.Popover>
  </Select>;
}

function RecordValue({ field, value, multiple, onChange }: { field: SourceFieldChoice; value: ConditionValue; multiple: boolean; onChange: (value: ConditionValue) => void }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ choices: { label: string; value: string }[]; total: number }>({ choices: [], total: 0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const formId = field.props?.associationFormId;
  const primary = field.props?.associationPrimaryFieldId;
  const [selectedChoices, setSelectedChoices] = useState<{ label: string; value: string }[]>([]);
  const selectedIds = JSON.stringify(Array.isArray(value) ? value : value ? [value] : []);
  useEffect(() => {
    if (!formId) return;
    let active = true;
    void Promise.all((JSON.parse(selectedIds) as string[]).map(async id => {
      const record = await loadConditionRecord(formId, id);
      const data = record.data as Record<string, unknown> | undefined;
      return { value: id, label: String(data?.[primary ?? ""] ?? id) };
    })).then(choices => { if (active) setSelectedChoices(choices); }).catch(() => { if (active) setSelectedChoices([]); });
    return () => { active = false; };
  }, [formId, primary, selectedIds]);
  useEffect(() => {
    if (!formId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      void loadConditionRecords(formId, primary, search, page).then(data => {
        if (!cancelled) setResult({ total: data.total, choices: data.items.map(record => ({ value: record.id, label: String(record.data[primary ?? ""] ?? record.id) })) });
      }).catch(() => { if (!cancelled) setError("关联记录加载失败，请检查权限或重试"); }).finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [formId, primary, search, page]);
  return <div className="space-y-1"><Input aria-label="搜索关联记录" placeholder="搜索关联记录" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /><ChoiceValue choices={[...result.choices, ...selectedChoices.filter(item => !result.choices.some(choice => choice.value === item.value))]} value={value} multiple={multiple} onChange={onChange} loading={loading} /><div className="flex items-center gap-1"><Button size="sm" variant="ghost" isDisabled={page === 1 || loading} onPress={() => setPage(page - 1)}>上一页</Button><span className="text-xs">{page}</span><Button size="sm" variant="ghost" isDisabled={page * 30 >= result.total || loading} onPress={() => setPage(page + 1)}>下一页</Button></div>{error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}</div>;
}

function IdentityValue({ value, multiple, onChange, department = false }: { value: ConditionValue; multiple: boolean; onChange: (value: ConditionValue) => void; department?: boolean }) {
  const [choices, setChoices] = useState<{ label: string; value: string }[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => { let active = true; void (department ? loadConditionDepartments() : loadConditionMembers()).then(choices => { if (active) setChoices(choices); }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, [department]);
  return <div><ChoiceValue choices={choices} value={value} multiple={multiple} onChange={onChange} />{error ? <p role="alert">成员加载失败</p> : null}</div>;
}

export function ConditionValueEditor({ field, operator, value, onChange }: { field?: SourceFieldChoice; operator: BranchRuleOperator; value: string; onChange: (value: string) => void }) {
  const decoded = decodeConditionValue(value);
  const change = (next: ConditionValue) => onChange(encodeConditionValue(next));
  const multiple = ["inAny", "notInAny", "containsAny", "containsAll", "containsNone"].includes(operator);
  const type = field?.fieldType ?? "singleLineText";
  if (field?.fieldType === "associationFormField") return <RecordValue key={field.key} field={field} value={decoded} multiple={multiple} onChange={change} />;
  if (type === "member") return <IdentityValue value={decoded} multiple={multiple} onChange={change} />;
  // Department currently stores configured option values, matching RuntimeSelect.
  if (type === "department") return <ChoiceValue choices={field?.options ?? []} value={decoded} multiple={multiple} onChange={change} />;
  if (field?.options.length) return <ChoiceValue choices={field.options} value={decoded} multiple={multiple} onChange={change} />;
  if (["boolean", "switch"].includes(type)) return <ChoiceValue choices={[{ label: "是", value: "true" }, { label: "否", value: "false" }]} value={decoded} multiple={false} onChange={next => change(next === "true")} />;
  const single = (current: ConditionValue, update: (next: ConditionValue) => void, label = "匹配值") => {
    if (numericTypes.has(type)) return <NumberField aria-label={label} value={current === "" || current === null ? NaN : Number(current)} onChange={next => update(Number.isFinite(next) ? next : null)} formatOptions={{ maximumFractionDigits: type === "integer" ? 0 : 15 }}><NumberField.Group><NumberField.DecrementButton /><NumberField.Input /><NumberField.IncrementButton /></NumberField.Group></NumberField>;
    if (dateTypes.has(type) && type !== "time") return <ConditionDateValue label={label} dateTime={type !== "date" || !!field?.props?.granularity && field.props.granularity !== "day"} value={String(current ?? "")} onChange={next => update(next)} />;
    if (type === "time") return <Input aria-label={label} type="time" value={String(current ?? "")} onChange={event => update(event.target.value)} />;
    return <Input aria-label={label} value={String(current ?? "")} onChange={event => update(event.target.value)} />;
  };
  if (operator === "between") { const range = Array.isArray(decoded) ? decoded : [null, null]; return <div className="flex gap-1">{single(range[0], next => change([next, range[1] ?? null]), "区间下界")}{single(range[1], next => change([range[0] ?? null, next]), "区间上界")}</div>; }
  if (multiple) { const values = Array.isArray(decoded) ? decoded : String(decoded ?? "").split(",").filter(Boolean); return <div className="space-y-1">{values.map((item, i) => <div key={i} className="flex gap-1">{single(item, next => change(values.map((v, index) => index === i ? next : v)))}<Button size="sm" aria-label="删除匹配值" onPress={() => change(values.filter((_, index) => index !== i))}>×</Button></div>)}<Button size="sm" variant="ghost" onPress={() => change([...values, ""])}>添加匹配值</Button></div>; }
  if (type === "multiLineText") return <TextArea aria-label="匹配值" value={String(decoded ?? "")} onChange={event => change(event.target.value)} />;
  return single(decoded, change);
}
