"use client";

import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "@heroui/react";
import { Modal } from "@heroui/react/modal";
import { listRoles, listUsers } from "@/features/form-designer";
import type { FieldPropsChangeHandler, PlacedField } from "../../designer-types";
import type { DesignerFieldProps } from "../CompTool";
import { PropertyRow } from "../property-panel/PropertyLayout";
import { PropertyButton, PropertySelectField, PropertySwitch } from "../property-panel/PropertyControls";

type IdentityUser = {
  id: string;
  displayName: string;
  jobNumber: string | null;
  sourceType: string;
  status: string;
};
type IdentityRole = {
  id: string;
  name: string;
  sourceType: string;
  status: string;
};
const MEMBER_SOURCES = [
  { value: "local", label: "本地" },
  { value: "dingtalk", label: "钉钉" },
  { value: "wecom", label: "企业微信" },
  { value: "feishu", label: "飞书" },
] as const;

export function MemberProperties({
  field,
  onPropsChange,
}: {
  field: PlacedField;
  onPropsChange: FieldPropsChangeHandler;
}) {
  const [isSelectorOpen, setSelectorOpen] = useState(false);
  const [users, setUsers] = useState<IdentityUser[]>([]);
  const [roles, setRoles] = useState<IdentityRole[]>([]);
  const [loading, setLoading] = useState(false);
  const source = field.props.memberOrganizationSource ?? "local";
  const scope = field.props.memberSelectableScope ?? "all";
  const format = field.props.memberDisplayFormat ?? "name";
  const selectedIds =
    scope === "roles"
      ? (field.props.memberRoleIds ?? [])
      : (field.props.memberUserIds ?? []);

  useEffect(() => {
    if (!isSelectorOpen) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      Promise.all([
        listUsers({ responseStyle: "fields" }),
        listRoles({ responseStyle: "fields" }),
      ])
        .then(([userResponse, roleResponse]) => {
          if (cancelled) return;
          setUsers(
            !userResponse.error &&
              userResponse.data?.code === 0 &&
              userResponse.data.data
              ? userResponse.data.data.map((user) => ({
                  id: user.id,
                  displayName: user.displayName,
                  jobNumber: user.jobNumber ?? null,
                  sourceType: user.sourceType,
                  status: user.status,
                }))
              : [],
          );
          setRoles(
            !roleResponse.error &&
              roleResponse.data?.code === 0 &&
              roleResponse.data.data
              ? roleResponse.data.data
              : [],
          );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isSelectorOpen]);

  const candidates = useMemo(() => {
    const matchesSource = (item: { sourceType: string }) =>
      item.sourceType === source;
    return scope === "roles"
      ? roles.filter((role) => matchesSource(role) && role.status === "active")
      : users.filter((user) => matchesSource(user) && user.status === "active");
  }, [roles, scope, source, users]);

  function updateSelected(id: string, selected: boolean) {
    const next = selected
      ? [...selectedIds, id]
      : selectedIds.filter((item) => item !== id);
    onPropsChange(
      field.id,
      scope === "roles" ? { memberRoleIds: next } : { memberUserIds: next },
    );
  }

  return (
    <>
      <PropertyRow label="组织来源">
        <PropertySelectField
          ariaLabel="组织来源"
          value={source}
          options={MEMBER_SOURCES}
          onChange={(value) =>
            onPropsChange(field.id, {
              memberOrganizationSource:
                value as DesignerFieldProps["memberOrganizationSource"],
              memberRoleIds: [],
              memberUserIds: [],
            })
          }
        />
      </PropertyRow>
      <PropertyRow label="可选范围">
        <PropertySelectField
          ariaLabel="可选范围"
          value={scope}
          options={[
            { value: "all", label: "全部成员" },
            { value: "roles", label: "指定角色" },
            { value: "members", label: "指定成员" },
          ]}
          onChange={(value) =>
            onPropsChange(field.id, {
              memberSelectableScope:
                value as DesignerFieldProps["memberSelectableScope"],
            })
          }
        />
      </PropertyRow>
      {scope !== "all" ? (
        <PropertyRow label="范围设置">
          <PropertyButton
            variant="ghost"
            onPress={() => setSelectorOpen(true)}
            className="min-w-0 flex-1 justify-between px-2"
          >
            <span>{scope === "roles" ? "设置角色" : "设置成员"}</span>
            <span>已选 {selectedIds.length}</span>
          </PropertyButton>
        </PropertyRow>
      ) : null}
      <PropertyRow label="成员格式">
        <PropertySelectField
          ariaLabel="成员格式"
          value={format}
          options={[
            { value: "name", label: "姓名" },
            { value: "nameJobNumber", label: "姓名(工号)" },
            { value: "nameUserId", label: "姓名(userId)" },
          ]}
          onChange={(value) =>
            onPropsChange(field.id, {
              memberDisplayFormat:
                value as DesignerFieldProps["memberDisplayFormat"],
            })
          }
        />
      </PropertyRow>
      <PropertyRow label="允许多选">
        <PropertySwitch
          aria-label="允许多选"
          isSelected={Boolean(field.props.memberMultiple)}
          onChange={(memberMultiple) =>
            onPropsChange(field.id, { memberMultiple })
          }
          className="justify-end"
        />
      </PropertyRow>
      <Modal isOpen={isSelectorOpen} onOpenChange={setSelectorOpen}>
        <Modal.Backdrop isDismissable>
          <Modal.Container placement="center" scroll="inside" size="sm">
            <Modal.Dialog className="flex max-h-[72vh] w-[min(520px,92vw)] flex-col overflow-hidden">
              <Modal.Header>
                <Modal.Heading>
                  选择{scope === "roles" ? "角色" : "成员"}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
                <p className="mb-3">
                  来源：
                  {
                    MEMBER_SOURCES.find((item) => item.value === source)?.label
                  }{" "}
                  · 可多选
                </p>
                {loading ? <div className="py-8">正在加载数据…</div> : null}
                {!loading && candidates.length === 0 ? (
                  <div className="py-8">
                    该组织来源暂无可选{scope === "roles" ? "角色" : "成员"}。
                  </div>
                ) : null}
                <div className="space-y-1">
                  {candidates.map((candidate) => {
                    const id = candidate.id;
                    const label =
                      scope === "roles"
                        ? (candidate as IdentityRole).name
                        : (candidate as IdentityUser).displayName;
                    const detail =
                      scope === "roles"
                        ? id
                        : (candidate as IdentityUser).jobNumber || id;
                    return (
                      <Checkbox
                        key={id}
                        isSelected={selectedIds.includes(id)}
                        onChange={(selected) => updateSelected(id, selected)}
                        className="flex w-full items-center gap-3 px-3 py-2"
                      >
                        <Checkbox.Content className="min-w-0 flex-1">
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <span className="block truncate">{label}</span>
                          <span className="max-w-36 truncate">{detail}</span>
                        </Checkbox.Content>
                      </Checkbox>
                    );
                  })}
                </div>
              </Modal.Body>
              <Modal.Footer className="flex justify-end px-5 py-3">
                <PropertyButton onPress={() => setSelectorOpen(false)}>
                  完成
                </PropertyButton>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
