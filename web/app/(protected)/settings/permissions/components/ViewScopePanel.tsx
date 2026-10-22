"use client";
import { useEffect, useState } from "react";
import {
  Checkbox,
  CheckboxGroup,
  Description,
  Label,
  Radio,
  RadioGroup,
} from "@heroui/react";
import { listFormViews } from "@/features/form-runtime/api";
import { PermissionPanel } from "./PermissionPanel";
export function ViewScopePanel({
  prefix,
  formId,
  grants,
  locked,
  onSelectScope,
  onSetViews,
}: {
  prefix: string;
  formId: string;
  grants: Set<string>;
  locked: boolean;
  onSelectScope: (kind: "data_scope" | "view_scope", value: string) => void;
  onSetViews: (prefix: string, viewIds: string[]) => void;
}) {
  const [views, setViews] = useState<Array<{ id: string; name: string }>>([
    { id: "default", name: "全部视图（默认视图）" },
  ]);
  const scope = grants.has(`${prefix}:view_scope:specified`)
    ? "specified"
    : "all";
  const selectedViews = [...grants]
    .filter((grant) => grant.startsWith(`${prefix}:view:`))
    .map((grant) => grant.slice(`${prefix}:view:`.length));
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void listFormViews({
        path: { formUuid: formId },
        responseStyle: "fields",
      }).then(({ data, error }) => {
        if (!error && data?.code === 0 && data.data)
          setViews([
            { id: "default", name: "全部视图（默认视图）" },
            ...data.data.map((view) => ({
              id: view.viewUuid,
              name: view.name,
            })),
          ]);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [formId]);
  return (
    <PermissionPanel title="可见视图">
      <Description>控制该角色可访问的表单视图范围。</Description>
      <RadioGroup
        aria-label="可见视图范围"
        value={scope}
        isDisabled={locked}
        onChange={(value) => onSelectScope("view_scope", value)}
        orientation="horizontal"
      >
        <Radio value="all">
          <Radio.Content>
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            <Label>全部视图</Label>
          </Radio.Content>
        </Radio>
        <Radio value="specified">
          <Radio.Content>
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            <Label>指定视图</Label>
          </Radio.Content>
        </Radio>
      </RadioGroup>
      {scope === "specified" ? (
        <CheckboxGroup
          aria-label="指定可见视图"
          value={selectedViews}
          isDisabled={locked}
          onChange={(values) => onSetViews(prefix, values)}
          className="grid gap-2 sm:grid-cols-2"
        >
          {views.map((view) => (
            <Checkbox key={view.id} value={view.id}>
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Label>{view.name}</Label>
              </Checkbox.Content>
            </Checkbox>
          ))}
        </CheckboxGroup>
      ) : null}
    </PermissionPanel>
  );
}
