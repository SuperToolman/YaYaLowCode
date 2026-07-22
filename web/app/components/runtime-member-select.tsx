"use client";

import { Avatar, ListBox, Select } from "@heroui/react";
import { useEffect, useMemo, useState, type Key } from "react";
import { listRoles, listUsers } from "../lib/api-client";
import type { RuntimeFieldProps, RuntimeSchemaField } from "./runtime-form-renderer";

type IdentityUser = {
  avatarUrl: string | null;
  id: string;
  displayName: string;
  jobNumber: string | null;
  sourceType: string;
  status: string;
  roles: string[];
};

type IdentityRole = {
  id: string;
  name: string;
  sourceType: string;
  status: string;
};

type RuntimeIdentityCatalog = {
  roles: IdentityRole[];
  users: IdentityUser[];
};

let catalogPromise: Promise<RuntimeIdentityCatalog> | null = null;

function loadIdentityCatalog() {
  if (!catalogPromise) {
    catalogPromise = Promise.all([
      listUsers({ responseStyle: "fields" }),
      listRoles({ responseStyle: "fields" }),
    ])
      .then(([usersResult, rolesResult]) => {
        const usersData = usersResult.data;
        const rolesData = rolesResult.data;
        if (
          usersResult.error ||
          !usersData ||
          usersData.code !== 0 ||
          !usersData.data ||
          rolesResult.error ||
          !rolesData ||
          rolesData.code !== 0 ||
          !rolesData.data
        ) {
          throw new Error("无法加载成员目录");
        }

        return {
          users: usersData.data.map((user) => ({
            avatarUrl: user.avatarUrl ?? null,
            displayName: user.displayName,
            id: user.id,
            jobNumber: user.jobNumber ?? null,
            roles: user.roles,
            sourceType: user.sourceType,
            status: user.status,
          })),
          roles: rolesData.data,
        };
      })
      .catch((error) => {
        catalogPromise = null;
        throw error;
      });
  }

  return catalogPromise;
}

export function RuntimeMemberSelect({
  field,
  onChange,
  placeholder,
  props,
  value,
}: {
  field: RuntimeSchemaField;
  onChange: (value: string | string[]) => void;
  placeholder: string;
  props: RuntimeFieldProps;
  value: string | string[];
}) {
  const [users, setUsers] = useState<IdentityUser[]>([]);
  const [roles, setRoles] = useState<IdentityRole[]>([]);
  const [isLoading, setLoading] = useState(true);
  const source = props.memberOrganizationSource ?? "local";
  const scope = props.memberSelectableScope ?? "all";
  const displayFormat = props.memberDisplayFormat ?? "name";
  const isMultiple = Boolean(props.memberMultiple);

  useEffect(() => {
    let cancelled = false;
    void loadIdentityCatalog()
      .then((catalog) => {
        if (cancelled) return;
        setUsers(catalog.users);
        setRoles(catalog.roles);
      })
      .catch(() => {
        if (!cancelled) {
          setUsers([]);
          setRoles([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const candidates = useMemo(() => {
    const sourceUsers = users.filter(
      (user) => user.sourceType === source && user.status === "active",
    );
    const selectedRoleNames = new Set(
      roles
        .filter((role) => (props.memberRoleIds ?? []).includes(role.id))
        .map((role) => role.name),
    );

    if (scope === "members") {
      return sourceUsers.filter((user) =>
        (props.memberUserIds ?? []).includes(user.id),
      );
    }
    if (scope === "roles") {
      return sourceUsers.filter((user) =>
        user.roles.some((roleName) => selectedRoleNames.has(roleName)),
      );
    }
    return sourceUsers;
  }, [props.memberRoleIds, props.memberUserIds, roles, scope, source, users]);

  const userById = useMemo(
    () => new Map(candidates.map((user) => [user.id, user])),
    [candidates],
  );
  const options = useMemo(
    () =>
      candidates.map((user) => ({
        value: user.id,
        label: getMemberLabel(user, displayFormat),
      })),
    [candidates, displayFormat],
  );

  if (isMultiple) {
    const selectedValues = Array.isArray(value) ? value : [];
    const selectedUsers = selectedValues.flatMap((selectedValue) => {
      const user = userById.get(selectedValue);
      return user ? [user] : [];
    });
    const maxVisibleNames = Math.max(1, field.colSpan ?? 1);
    const visibleUsers = selectedUsers.slice(0, maxVisibleNames);
    const overflowCount = selectedUsers.length - visibleUsers.length;

    return (
      <Select
        aria-label={field.label}
        className="low-code-select-field"
        selectionMode="multiple"
        value={selectedValues}
        onChange={(keys) => onChange(keys.map(String))}
        shouldCloseOnSelect={false}
        isDisabled={Boolean(props.isDisabled || props.isReadOnly || isLoading)}
        isRequired={props.isRequired}
        fullWidth
      >
        <Select.Trigger className="min-w-0">
          <Select.Value className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
            {isLoading ? "正在加载成员…" : selectedUsers.length > 0 ? (
              <span className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden">
                <span className="flex shrink-0 -space-x-1.5">
                  {selectedUsers.slice(0, 3).map((user) => (
                    <MemberAvatar key={user.id} user={user} />
                  ))}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {visibleUsers
                    .map((user) => getMemberLabel(user, displayFormat))
                    .join("、")}
                  {overflowCount > 0 ? `、等${overflowCount}位成员…` : ""}
                </span>
              </span>
            ) : (
              placeholder
            )}
          </Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox
            selectionMode="multiple"
            selectedKeys={new Set(selectedValues)}
            onSelectionChange={(keys) =>
              onChange(
                keys === "all"
                  ? options.map((option) => option.value)
                  : Array.from(keys).map(String),
              )
            }
            renderEmptyState={() => "暂无可选成员"}
          >
            {options.map((option) => {
              const user = userById.get(option.value);
              if (!user) return null;

              return (
                <ListBox.Item
                  key={option.value}
                  id={option.value}
                  textValue={option.label}
                  className={
                    selectedValues.includes(option.value)
                      ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
                      : undefined
                  }
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <MemberOption user={user} label={option.label} />
                    {selectedValues.includes(option.value) ? (
                      <span
                        className="ml-auto shrink-0 text-[var(--color-primary)]"
                        aria-label="已选"
                      >
                        ✓
                      </span>
                    ) : null}
                  </span>
                </ListBox.Item>
              );
            })}
          </ListBox>
        </Select.Popover>
      </Select>
    );
  }

  const selectedValue = typeof value === "string" ? value : "";
  const selectedUser = userById.get(selectedValue);

  return (
    <Select
      aria-label={field.label}
      className="low-code-select-field"
      selectedKey={selectedValue || null}
      onSelectionChange={(key: Key | null) =>
        onChange(key === null ? "" : String(key))
      }
      isDisabled={Boolean(props.isDisabled || props.isReadOnly || isLoading)}
      isRequired={props.isRequired}
      fullWidth
    >
      <Select.Trigger>
        <Select.Value>
          {isLoading ? (
            "正在加载成员…"
          ) : selectedUser ? (
            <MemberOption
              user={selectedUser}
              label={getMemberLabel(selectedUser, displayFormat)}
            />
          ) : (
            placeholder
          )}
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox renderEmptyState={() => "暂无可选成员"}>
          {options.map((option) => {
            const user = userById.get(option.value);
            return user ? (
              <ListBox.Item
                key={option.value}
                id={option.value}
                textValue={option.label}
              >
                <MemberOption user={user} label={option.label} />
              </ListBox.Item>
            ) : null;
          })}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function getMemberLabel(
  user: IdentityUser,
  displayFormat: NonNullable<RuntimeFieldProps["memberDisplayFormat"]>,
) {
  if (displayFormat === "nameJobNumber") {
    return `${user.displayName}(${user.jobNumber || "-"})`;
  }
  if (displayFormat === "nameUserId") return `${user.displayName}(${user.id})`;
  return user.displayName;
}

function MemberAvatar({ user }: { user: IdentityUser }) {
  return (
    <Avatar
      size="sm"
      className="h-5 w-5 shrink-0 border border-[var(--color-bg-surface)] text-[9px]"
    >
      {user.avatarUrl ? <Avatar.Image src={user.avatarUrl} alt="" /> : null}
      <Avatar.Fallback>{fallbackText(user.displayName)}</Avatar.Fallback>
    </Avatar>
  );
}

function MemberOption({ label, user }: { label: string; user: IdentityUser }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <MemberAvatar user={user} />
      <span className="truncate">{label}</span>
    </span>
  );
}

function fallbackText(displayName: string) {
  return Array.from(displayName.trim())[0] || "?";
}
