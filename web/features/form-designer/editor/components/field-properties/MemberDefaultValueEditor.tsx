"use client";

import { useEffect, useMemo, useState } from "react";
import { MemberMultiSelect } from "@/shared/ui/MemberMultiSelect";
import { fetchRuntimeIdentityCatalog } from "@/features/form-runtime/api";
import type { RuntimeIdentityCatalog } from "@/features/form-runtime/types";
import { notifyRequestError } from "@/shared/lib/notify";
import type { FieldPropsChangeHandler, PlacedField } from "../../designer-types";
import { DefaultValueTypeSegmented } from "./DefaultValueTypeSegmented";

export function MemberDefaultValueEditor({ field, onPropsChange }: {
  field: PlacedField;
  onPropsChange: FieldPropsChangeHandler;
}) {
  const [catalog, setCatalog] = useState<RuntimeIdentityCatalog>({ users: [], roles: [] });
  const [loading, setLoading] = useState(false);
  const type = field.props.defaultValueType === "custom" || field.props.defaultValueType === "currentUser"
    ? field.props.defaultValueType : "none";
  const source = field.props.memberOrganizationSource ?? "local";
  const scope = field.props.memberSelectableScope ?? "all";
  const multiple = Boolean(field.props.memberMultiple);

  useEffect(() => {
    if (type !== "custom") return;
    const controller = new AbortController();
    void fetchRuntimeIdentityCatalog(controller.signal)
      .then(setCatalog)
      .catch((error) => { if (!controller.signal.aborted) notifyRequestError(error, "无法加载成员目录"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [type]);

  const options = useMemo(() => {
    const roleNames = new Set(catalog.roles.filter((role) => (field.props.memberRoleIds ?? []).includes(role.id)).map((role) => role.name));
    return catalog.users.filter((user) => user.status === "active" && user.sourceType === source
      && (scope !== "members" || (field.props.memberUserIds ?? []).includes(user.id))
      && (scope !== "roles" || user.roles.some((role) => roleNames.has(role))))
      .map((user) => ({ id: user.id, label: user.displayName, avatarUrl: user.avatarUrl, sourceType: user.sourceType, searchText: `${user.jobNumber ?? ""} ${user.id}` }));
  }, [catalog, field.props.memberRoleIds, field.props.memberUserIds, scope, source]);
  const stored = field.props.defaultValue;
  const selected = Array.isArray(stored) ? stored : typeof stored === "string" && stored ? [stored] : [];

  return <div className="w-full min-w-0 flex-1 space-y-1 overflow-hidden">
    <DefaultValueTypeSegmented options={["none", "custom", "currentUser"]} value={type} onChange={(next) => {
      if (next === type) return;
      setLoading(next === "custom");
      onPropsChange(field.id, { defaultValueType: next, defaultValue: multiple ? [] : "", defaultValueFormula: "", defaultValueLinkage: "" });
    }} />
    {type === "custom" ? <MemberMultiSelect
      options={options}
      selectionMode={multiple ? "multiple" : "single"}
      value={multiple ? selected : selected.slice(0, 1)}
      onChange={(ids) => onPropsChange(field.id, { defaultValue: multiple ? ids : ids[0] ?? "" })}
      placeholder={loading ? "正在加载成员…" : "选择默认成员"}
    /> : null}
  </div>;
}
