"use client";
import type { ReactNode } from "react";
import {
  Card,
  Checkbox,
  Description,
  Label,
  Radio,
  RadioGroup,
} from "@heroui/react";
import { actionLabels } from "./permission-config";
export function PermissionPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="shrink-0">
      <Card.Header>
        <Card.Title>{title}</Card.Title>
      </Card.Header>
      <Card.Content>{children}</Card.Content>
    </Card>
  );
}
export function OperationChecks({
  actions,
  prefix,
  selected,
  locked,
  onToggle,
  labels = actionLabels,
}: {
  actions: readonly string[];
  prefix: string;
  selected: (action: string) => boolean;
  locked: boolean;
  onToggle: (grant: string) => void;
  labels?: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {actions.map((action) => (
        <Checkbox
          key={`${prefix}:${action}`}
          isSelected={selected(action)}
          isDisabled={locked}
          onChange={() => onToggle(`${prefix}:${action}`)}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label>{labels[action] ?? action}</Label>
          </Checkbox.Content>
        </Checkbox>
      ))}
    </div>
  );
}
export function ScopePanel({
  title,
  description,
  prefix,
  kind,
  grants,
  locked,
  onSelect,
  options,
}: {
  title: string;
  description: string;
  prefix: string;
  kind: "data_scope" | "view_scope";
  grants: Set<string>;
  locked: boolean;
  onSelect: (kind: "data_scope" | "view_scope", value: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  const selected =
    options.find(([value]) => grants.has(`${prefix}:${kind}:${value}`))?.[0] ??
    "all";
  return (
    <PermissionPanel title={title}>
      <Description>{description}</Description>
      <RadioGroup
        aria-label={title}
        value={selected}
        isDisabled={locked}
        onChange={(value) => onSelect(kind, value)}
        orientation="horizontal"
      >
        {options.map(([value, label]) => (
          <Radio key={value} value={value}>
            <Radio.Content>
              <Radio.Control>
                <Radio.Indicator />
              </Radio.Control>
              <Label>{label}</Label>
            </Radio.Content>
          </Radio>
        ))}
      </RadioGroup>
    </PermissionPanel>
  );
}
