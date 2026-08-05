"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Button, Input, ListBox, Select } from "@heroui/react";
import type { ApiFormSummary } from "@/features/automation-editor/api";
import { AutomationFormulaEditorModal, type AutomationFormulaField } from "../automation-formula-editor-modal";
import { extractExpressionTokens, type FormFieldDescriptor } from "./automation-editor-model";

export function IconActionButton({
  ariaLabel,
  children,
  danger = false,
  isDisabled = false,
  onClick,
}: {
  ariaLabel: string;
  children: ReactNode;
  danger?: boolean;
  isDisabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      isIconOnly
      aria-label={ariaLabel}
      variant="ghost"
      isDisabled={isDisabled}
      className={[
        "h-7 min-h-7 w-7 min-w-7 rounded-md border p-0 disabled:opacity-35",
        danger
          ? "border-transparent text-[var(--color-danger)] hover:border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
          : "border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-control-soft-hover)] hover:text-[var(--color-text-primary)]",
      ].join(" ")}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function PropertyPanelSection({
  children,
  description,
  title,
}: {
  children?: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-control-soft)]">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-control-soft)] px-3 py-2">
        <div className="automation-property-title font-semibold text-[var(--color-text-primary)]">{title}</div>
        {description ? (
          <div className="mt-0.5 text-[var(--color-text-secondary)]">{description}</div>
        ) : null}
      </div>
      <div className="space-y-2 px-3 py-2.5">{children}</div>
    </section>
  );
}

export function PropertyField({
  alignStart,
  children,
  label,
}: {
  alignStart?: boolean;
  children: ReactNode;
  label: string;
}) {
  return (
    <div
      className={[
        "grid gap-2 md:grid-cols-[88px_minmax(0,1fr)]",
        alignStart ? "md:items-start" : "md:items-center",
      ].join(" ")}
    >
      <div className="automation-property-label font-medium text-[var(--color-text-primary)] md:pt-0.5">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function MappingFormulaInput({
  fields,
  fieldLabel,
  value,
  onChange,
}: {
  fields: AutomationFormulaField[];
  fieldLabel: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);

  function openEditor() {
    setDraftValue(value);
    setIsOpen(true);
  }

  function closeEditor() {
    setIsOpen(false);
  }

  function confirmFormula() {
    onChange(draftValue);
    closeEditor();
  }

  return (
    <>
      <Input
        readOnly
        aria-label="公式值"
        fullWidth
        className="h-9 min-h-9 w-full min-w-0 cursor-pointer font-mono"
        placeholder="点击配置公式"
        value={value}
        onClick={openEditor}
      />
      <AutomationFormulaEditorModal
        fields={fields}
        fieldLabel={fieldLabel}
        isOpen={isOpen}
        value={draftValue}
        onChange={setDraftValue}
        onConfirm={confirmFormula}
        onOpenChange={(open) => (open ? openEditor() : closeEditor())}
      />
    </>
  );
}

export function TextAreaInput({
  ariaLabel,
  placeholder,
  value,
  onChange,
}: {
  ariaLabel: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      aria-label={ariaLabel}
      className="min-h-[88px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-primary)]"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

export function ExpressionEditor({
  ariaLabel,
  helperText,
  options,
  placeholder,
  value,
  onChange,
}: {
  ariaLabel: string;
  helperText?: string;
  options: Array<{ key: string; label: string; fieldType: string }>;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const tokenMatches = extractExpressionTokens(value);
  const optionMap = new Map(options.map((option) => [option.key, option]));
  const resolvedTokens = tokenMatches
    .map((token) => ({
      token,
      option: optionMap.get(token),
    }))
    .filter((item, index, array) => array.findIndex((candidate) => candidate.token === item.token) === index);
  const invalidTokens = resolvedTokens.filter((item) => !item.option);
  const validTokens = resolvedTokens.filter((item): item is { token: string; option: { key: string; label: string; fieldType: string } } =>
    Boolean(item.option),
  );

  const insertToken = (token: string) => {
    const nextValue = value.trim() ? `${value} ${token}` : token;
    onChange(nextValue);
  };

  return (
    <div className="space-y-3">
      <textarea
        aria-label={ariaLabel}
        className="min-h-[96px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 font-mono text-sm leading-6 text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-primary)]"
        placeholder={placeholder}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {helperText ? (
        <div className="text-xs leading-5 text-[var(--color-text-secondary)]">{helperText}</div>
      ) : null}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-control-soft)] p-3">
        <div className="text-xs font-medium text-[var(--color-text-primary)]">表达式检查</div>
        {value.trim().length === 0 ? (
          <div className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
            直接输入表达式，字段引用格式为 <code>{`{{nodeId:fieldId}}`}</code>。
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {validTokens.length > 0 ? (
              <div>
                <div className="text-xs text-[var(--color-text-secondary)]">已引用字段</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {validTokens.map((item) => (
                    <span
                      key={item.token}
                      className="rounded-md border border-[var(--color-primary)] bg-[var(--color-primary-soft)] px-2.5 py-1 text-xs text-[var(--color-primary)]"
                    >
                      {item.option.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-[var(--color-text-secondary)]">当前表达式未引用字段。</div>
            )}
            {invalidTokens.length > 0 ? (
              <div className="rounded-md border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-xs leading-5 text-[var(--color-danger)]">
                无效字段引用：{invalidTokens.map((item) => `{{${item.token}}}`).join("、")}
              </div>
            ) : null}
          </div>
        )}
      </div>
      {options.length > 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-control-soft)] p-3">
          <div className="text-xs font-medium text-[var(--color-text-primary)]">插入字段引用</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {options.map((option) => (
              <button
                key={option.key}
                type="button"
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2.5 py-1 text-xs text-[var(--color-text-primary)] transition hover:bg-[var(--color-primary-soft)]"
                onClick={() => insertToken(`{{${option.key}}}`)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function FormSelect({
  forms,
  value,
  placeholder,
  onChange,
}: {
  forms: ApiFormSummary[];
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      aria-label={placeholder}
      selectedKey={value || "none"}
      onSelectionChange={(key) => onChange(String(key === "none" ? "" : key ?? ""))}
    >
      <Select.Trigger>
        <Select.Value>
          {forms.find((form) => form.id === value)?.name ?? placeholder}
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="none" textValue="未配置">
            未配置
          </ListBox.Item>
          {forms.map((form) => (
            <ListBox.Item key={form.id} id={form.id} textValue={form.name}>
              {form.name}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function UpdateTargetFormSelect({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      aria-label="选择更新目标表单"
      selectedKey={value || "none"}
      onSelectionChange={(key) => onChange(String(key === "none" ? "" : key ?? ""))}
    >
      <Select.Trigger>
        <Select.Value>
          {options.find((option) => option.id === value)?.label ?? "选择目标表单"}
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="none" textValue="未配置">
            未配置
          </ListBox.Item>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function FieldSelect({
  fields,
  value,
  onChange,
}: {
  fields: FormFieldDescriptor[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      aria-label="字段名"
      fullWidth
      className="min-w-0"
      selectedKey={value || "none"}
      onSelectionChange={(key) => onChange(String(key === "none" ? "" : key ?? ""))}
    >
      <Select.Trigger>
        <Select.Value>
          {fields.find((field) => field.id === value)?.label ?? "字段名"}
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="none" textValue="未配置">
            未配置
          </ListBox.Item>
          {fields.map((field) => (
            <ListBox.Item key={field.id} id={field.id} textValue={field.label}>
              {field.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function SourceFieldSelect({
  options,
  value,
  onChange,
}: {
  options: Array<{ key: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      aria-label="来源字段"
      fullWidth
      className="min-w-0"
      selectedKey={value || "none"}
      onSelectionChange={(key) => onChange(String(key === "none" ? "" : key ?? ""))}
    >
      <Select.Trigger>
        <Select.Value>
          {options.find((option) => option.key === value)?.label ?? "字段值"}
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="none" textValue="未配置">
            未配置
          </ListBox.Item>
          {options.map((option) => (
            <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function FieldValueInput({
  field,
  value,
  onChange,
}: {
  field?: FormFieldDescriptor;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field?.type === "select" || field?.type === "radio") {
    return (
      <Select
        aria-label={field ? `${field.label}字段值` : "字段值"}
        fullWidth
        className="min-w-0"
        selectedKey={value || "none"}
        onSelectionChange={(key) => onChange(String(key === "none" ? "" : key ?? ""))}
      >
        <Select.Trigger>
          <Select.Value>
            {field.options.find((option) => option.value === value)?.label ?? "字段值"}
          </Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="none" textValue="未配置">
              未配置
            </ListBox.Item>
            {field.options.map((option) => (
              <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                {option.label}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    );
  }

  if (field?.type === "multiSelect" || field?.type === "checkbox") {
    return (
      <Input
        aria-label="字段值"
        fullWidth
        className="h-9 min-h-9 w-full min-w-0"
        placeholder="多个值用逗号分隔"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    );
  }

  return (
    <Input
      aria-label="字段值"
      fullWidth
      className="h-9 min-h-9 w-full min-w-0"
      placeholder={field ? `${field.label} 的值` : "字段值"}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}
