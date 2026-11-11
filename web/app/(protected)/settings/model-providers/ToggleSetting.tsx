"use client";

import { Switch } from "@heroui/react";

export function ToggleSetting({
  title,
  description,
  selected,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onChange: (selected: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-5 py-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
          {description}
        </p>
      </div>
      <Switch
        aria-label={title}
        isSelected={selected}
        isDisabled={disabled}
        onChange={onChange}
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
    </div>
  );
}
