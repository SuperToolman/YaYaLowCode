"use client";
import { Checkbox, Description, EmptyState } from "@heroui/react";
import type { PermissionState } from "./permission-types";
export function PermissionCheckbox({
  label,
  state,
  isDisabled = false,
  onChange,
}: {
  label: string;
  state: PermissionState;
  isDisabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox
      aria-label={label}
      isSelected={state === "all"}
      isIndeterminate={state === "partial"}
      isDisabled={isDisabled}
      onChange={onChange}
      className="shrink-0"
    >
      <Checkbox.Content>
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
      </Checkbox.Content>
    </Checkbox>
  );
}
export function StatusTag({
  value,
  tone,
}: {
  value: string;
  tone: PermissionState | "neutral";
}) {
  const color =
    tone === "all"
      ? "success"
      : tone === "partial"
        ? "warning"
        : tone === "neutral"
          ? "accent"
          : "default";
  return (
    // HeroUI 3.2.3's chipVariants slot functions share mutable variant state.
    // Use its CSS classes directly so another Chip cannot change this status.
    <span
      data-slot="chip"
      className={`chip chip--sm chip--soft chip--${color}`}
    >
      <span data-slot="chip-label" className="chip__label">
        {value}
      </span>
    </span>
  );
}
export function Empty({ text }: { text: string }) {
  return (
    <EmptyState>
      <Description>{text}</Description>
    </EmptyState>
  );
}
