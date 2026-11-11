"use client";

import type { ChangeEvent, ComponentProps, ReactNode } from "react";
import { Button, Input, InputGroup, ListBox, NumberField, Select, Switch, Tabs, TextArea, ToggleButton, ToggleButtonGroup } from "@heroui/react";

// Presentation only: field types, option catalogs and persistence belong to callers.
function cx<T>(base: string, extra?: string | ((values: T) => string)) {
  if (typeof extra === "function") {
    return (values: T) => [base, extra(values)].filter(Boolean).join(" ");
  }
  return [base, extra].filter(Boolean).join(" ");
}

export function PropertyInput({
  className,
  ...props
}: ComponentProps<typeof Input>) {
  return (
    <Input {...props} className={cx("min-w-0 text-xs sm:text-xs", className)} />
  );
}

export function PropertyTextArea({
  className,
  ...props
}: ComponentProps<typeof TextArea>) {
  return (
    <TextArea
      {...props}
      className={cx("min-w-0 text-xs sm:text-xs", className)}
    />
  );
}

export function PropertyButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "size">) {
  return <Button {...props} size="sm" className={cx("text-xs!", className)} />;
}

function PropertySelectRoot(props: ComponentProps<typeof Select>) {
  return <Select {...props} />;
}
function PropertySelectTrigger({
  className,
  ...props
}: ComponentProps<typeof Select.Trigger>) {
  return (
    <Select.Trigger
      {...props}
      className={cx("h-auto min-h-0 text-xs!", className)}
    />
  );
}
function PropertySelectValue({
  className,
  ...props
}: ComponentProps<typeof Select.Value>) {
  return <Select.Value {...props} className={cx("text-xs sm:text-xs", className)} />;
}
function PropertySelectPopover({
  className,
  ...props
}: ComponentProps<typeof Select.Popover>) {
  return (
    <Select.Popover
      {...props}
      className={cx("text-xs [&_[role=option]]:text-xs [&_[data-slot=label]]:text-xs [&_[data-slot=description]]:text-xs", className)}
    />
  );
}
export const PropertySelect = Object.assign(PropertySelectRoot, {
  Value: PropertySelectValue,
  Indicator: Select.Indicator,
  Trigger: PropertySelectTrigger,
  Popover: PropertySelectPopover,
});

function PropertyInputGroupRoot(props: ComponentProps<typeof InputGroup>) {
  return <InputGroup {...props} />;
}
function PropertyInputGroupTextArea({
  className,
  ...props
}: ComponentProps<typeof InputGroup.TextArea>) {
  return (
    <InputGroup.TextArea
      {...props}
      className={cx("text-xs sm:text-xs", className)}
    />
  );
}
export const PropertyInputGroup = Object.assign(PropertyInputGroupRoot, {
  TextArea: PropertyInputGroupTextArea,
});

export function PropertyToggleGroup(
  props: Omit<ComponentProps<typeof ToggleButtonGroup>, "size">,
) {
  return <ToggleButtonGroup {...props} size="sm" />;
}
export function PropertyToggle({
  className,
  ...props
}: ComponentProps<typeof ToggleButton>) {
  return <ToggleButton {...props} className={cx("text-xs!", className)} />;
}

export function PropertySelectField({
  ariaLabel,
  className,
  options,
  value,
  onChange,
  placeholder = "请选择",
}: {
  ariaLabel: string;
  className?: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <PropertySelect
      aria-label={ariaLabel}
      className={cx("min-w-0 flex-1", className)}
      selectedKey={
        options.some((option) => option.value === value) ? value : null
      }
      onSelectionChange={(key) => onChange(key === null ? "" : String(key))}
    >
      <PropertySelect.Trigger>
        <PropertySelect.Value>
          {options.find((option) => option.value === value)?.label ??
            placeholder}
        </PropertySelect.Value>
        <PropertySelect.Indicator />
      </PropertySelect.Trigger>
      <PropertySelect.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={option.value}
              id={option.value}
              textValue={option.label}
            >
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </PropertySelect.Popover>
    </PropertySelect>
  );
}

export function PropertySegmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Tabs
      className="min-w-0 flex-1"
      selectedKey={value}
      onSelectionChange={(key) => {
        const option = options.find((item) => item.value === key);
        if (option) onChange(option.value);
      }}
    >
      <Tabs.ListContainer className="w-full min-w-0">
        <Tabs.List aria-label="属性选项" className="w-full">
          {options.map((option) => (
            <Tabs.Tab
              key={option.value}
              id={option.value}
              className="min-w-0 flex-1 px-1 text-xs!"
            >
              <span className="truncate">{option.label}</span>
              <Tabs.Indicator />
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  );
}

export function PropertyTextField({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <PropertyInput
      aria-label="属性值"
      className="flex-1 text-xs sm:text-xs"
      value={value}
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        onChange(event.currentTarget.value)
      }
    />
  );
}

export function PropertyNumberField({
  max,
  min,
  onChange,
  value,
}: {
  max?: number;
  min?: number;
  onChange: (value: number | undefined) => void;
  value?: number;
}) {
  return (
    <NumberField
      aria-label="数值属性"
      className="min-w-0 flex-1 text-xs"
      maxValue={max}
      minValue={min}
      value={value ?? NaN}
      onChange={(next) => onChange(Number.isNaN(next) ? undefined : next)}
      fullWidth
    >
      <NumberField.Group>
        <NumberField.DecrementButton className="text-xs">
          -
        </NumberField.DecrementButton>
        <NumberField.Input className="text-xs sm:text-xs" />
        <NumberField.IncrementButton className="text-xs">
          +
        </NumberField.IncrementButton>
      </NumberField.Group>
    </NumberField>
  );
}

export function PropertySwitch({
  className,
  "aria-label": ariaLabel = "开关",
  ...props
}: Omit<ComponentProps<typeof Switch>, "children" | "size">) {
  return (
    <Switch
      {...props}
      aria-label={ariaLabel}
      size="sm"
      className={cx("justify-center text-xs", className)}
    >
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}

export function PropertyIconAction({
  icon,
  label,
}: {
  icon: ReactNode;
  label: string;
}) {
  return (
    <PropertyButton
      isIconOnly
      className="text-xs"
      variant="ghost"
      aria-label={label}
    >
      {icon}
    </PropertyButton>
  );
}

export function PropertyCodeToken() {
  return <span className="font-mono text-xs">{"{}"}</span>;
}
