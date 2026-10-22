"use client";
import { assertApiEnvelope } from "@lib/api-request";

import { notifyRequestError } from "@lib/notify";
import { useAuth } from "@components/AuthProvider";
import { useCallback, useEffect, useMemo, useState } from "react";
import { notify } from "@lib/notify";
import {
  ButtonGroup,
  Button,
  Input,
  Modal,
  Tabs,
  TagGroup,
  Tag,
} from "@heroui/react";
import { MySurface } from "@/components/ui/MySurface";
import {
  createLocalRole,
  deleteLocalRole,
  listRoles,
  updateLocalRole,
} from "@/features/identity-access/api";
import { SettingsContentCard } from "../components/SettingsContentCard";
import { ArrowRotateRight } from "@gravity-ui/icons";

type Role = {
  id: string;
  sourceType: string;
  externalId: string;
  name: string;
  status: string;
  memberCount: number;
};
type RoleSourceFilter = "all" | "local" | "dingtalk";

export default function RolesSettingsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("settings.roles.manage");
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<RoleSourceFilter>("all");
  const [editing, setEditing] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const [deletingRole, setDeletingRole] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error , response: httpResponse0 } = await listRoles({ responseStyle: "fields" });
      assertApiEnvelope(data, error, httpResponse0);
      setRoles(data.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载角色");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const filteredRoles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return roles.filter(
      (role) =>
        (sourceFilter === "all" || role.sourceType === sourceFilter) &&
        (!normalized ||
          role.name.toLocaleLowerCase("zh-CN").includes(normalized)),
    );
  }, [query, roles, sourceFilter]);
  function edit(role?: Role) {
    setEditing(role ?? null);
    setName(role?.name ?? "");
    setOpen(true);
  }
  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const { data, error, response } = editing
        ? await updateLocalRole({
            path: { roleId: editing.id },
            body: { name },
            responseStyle: "fields",
          })
        : await createLocalRole({ body: { name }, responseStyle: "fields" });
      assertApiEnvelope(data, error, response);
      setOpen(false);
      notify.success(editing ? "角色已更新" : "角色已创建");
      await load();
    } catch (reason) {
      notifyRequestError(reason, "保存角色失败", {
        description: reason instanceof Error ? reason.message : "请稍后重试",
      });
    } finally {
      setSaving(false);
    }
  }
  async function status(role: Role) {
    await mutate(role, {
      status: role.status === "active" ? "inactive" : "active",
    });
  }
  async function remove(role: Role) {
    setDeletingRole(true);
    setError("");
    try {
      const { error } = await deleteLocalRole({
        path: { roleId: role.id },
        responseStyle: "fields",
      });
      if (error) throw new Error("删除失败");
      setDeleting(null);
      notify.success("角色已删除");
      await load();
    } catch (reason) {
      notifyRequestError(reason, "删除角色失败", {
        description: reason instanceof Error ? reason.message : "请稍后重试",
      });
    } finally {
      setDeletingRole(false);
    }
  }
  async function mutate(role: Role, data: { name?: string; status?: string }) {
    setError("");
    try {
      const { data: response, error , response: httpResponse1 } = await updateLocalRole({
        path: { roleId: role.id },
        body: data,
        responseStyle: "fields",
      });
      assertApiEnvelope(response, error, httpResponse1);
      notify.success(data.status ? "角色状态已更新" : "角色已更新");
      await load();
    } catch (reason) {
      notifyRequestError(reason, "更新角色失败", {
        description: reason instanceof Error ? reason.message : "请稍后重试",
      });
    }
  }
  return (
    <SettingsContentCard
      title="角色管理"
      subtitle={`管理平台角色与来源状态。共 ${roles.length} 个角色，其中 ${roles.filter((item) => item.status === "active").length} 个已启用。`}
      headerActions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Input
            aria-label="搜索角色"
            className="w-64"
            placeholder="搜索角色"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <ButtonGroup>
            <Button isDisabled={!canManage} variant="secondary" onPress={() => edit()}>
              添加角色
            </Button>
            <Button
              variant="secondary"
              isDisabled={loading}
              onPress={() => void load()}
            >
              <ArrowRotateRight />
              {loading ? "刷新中…" : "刷新"}
            </Button>
          </ButtonGroup>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SourceFilterTabs value={sourceFilter} onChange={setSourceFilter} />
          <p className="text-xs text-[var(--color-text-secondary)]">
            平台 {roles.filter((item) => item.sourceType === "local").length} 个
          </p>
        </div>
        {error ? (
          <p className="rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filteredRoles.map((role) => (
            <RoleCard
              key={role.id}
              canManage={canManage}
              role={role}
              onEdit={edit}
              onStatus={status}
              onDelete={setDeleting}
            />
          ))}
        </div>
        {!loading && filteredRoles.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center text-sm text-[var(--color-text-secondary)]">
            没有符合当前条件的角色。
          </div>
        ) : null}
      </div>
      <RoleModal
        open={open}
        editing={editing}
        name={name}
        saving={saving}
        onName={setName}
        onClose={() => setOpen(false)}
        onSave={save}
      />
      <RoleDeleteModal
        role={deleting}
        deleting={deletingRole}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && void remove(deleting)}
      />
    </SettingsContentCard>
  );
}
function RoleCard({
  canManage,
  role,
  onEdit,
  onStatus,
  onDelete,
}: {
  canManage: boolean;
  role: Role;
  onEdit: (role: Role) => void;
  onStatus: (role: Role) => void;
  onDelete: (role: Role) => void;
}) {
  const editable =
    canManage && role.sourceType === "local" && role.externalId !== "system-administrator";
  const reason = !canManage ? "没有管理角色的权限" :
    role.sourceType !== "local" ? "同步角色不可修改" : "系统管理员角色受保护";
  return (
    <MySurface className="p-2 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 flex gap-2">
          <h3 className="truncate">{role.name}</h3>
        </div>
        <span className="flex gap-2 shrink-0">
          <SourceTag source={role.sourceType} />
          <StatusTag status={role.status} />
        </span>
      </div>
      <p className="break-all text-xs leading-5 text-[var(--color-text-secondary)] truncate">
        {role.externalId}
      </p>
      <div className="flex items-center justify-between">
        <span className="min-w-0 flex-1 break-words text-xs leading-5 text-[var(--color-text-secondary)]">
          {editable ? "" : reason}
        </span>
        <div className="flex shrink-0 gap-1">
          <IconAction
            title={editable ? "编辑角色" : reason}
            disabled={!editable}
            onPress={() => onEdit(role)}
          >
            <EditIcon />
          </IconAction>
          <IconAction
            title={
              editable
                ? role.status === "active"
                  ? "禁用角色"
                  : "启用角色"
                : reason
            }
            disabled={!editable}
            onPress={() => void onStatus(role)}
          >
            {role.status === "active" ? <DisableIcon /> : <EnableIcon />}
          </IconAction>
          <IconAction
            title={editable ? "删除角色" : reason}
            disabled={!editable}
            danger
            onPress={() => onDelete(role)}
          >
            <TrashIcon />
          </IconAction>
        </div>
      </div>
    </MySurface>
  );
}
function SourceFilterTabs({
  value,
  onChange,
}: {
  value: RoleSourceFilter;
  onChange: (value: RoleSourceFilter) => void;
}) {
  return (
    <Tabs
      variant="secondary"
      selectedKey={value}
      onSelectionChange={(key) => onChange(key as RoleSourceFilter)}
    >
      <Tabs.List aria-label="角色来源筛选">
        <Tabs.Tab id="all" className="px-3 py-1.5 text-xs">
          全部
          <Tabs.Indicator />
        </Tabs.Tab>
        <Tabs.Tab id="local" className="px-3 py-1.5 text-xs">
          平台
          <Tabs.Indicator />
        </Tabs.Tab>
        <Tabs.Tab id="dingtalk" className="px-3 py-1.5 text-xs">
          钉钉
          <Tabs.Indicator />
        </Tabs.Tab>
      </Tabs.List>
    </Tabs>
  );
}
function RoleModal({
  open,
  editing,
  name,
  saving,
  onName,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: Role | null;
  name: string;
  saving: boolean;
  onName: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Modal isOpen={open} onOpenChange={(value) => !value && onClose()}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" size="sm">
          <Modal.Dialog className="rounded-2xl bg-[var(--color-bg-surface)]">
            <Modal.Header>
              <Modal.Heading>{editing ? "编辑角色" : "新增角色"}</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭" />
            </Modal.Header>
            <Modal.Body>
              <Input
                autoFocus
                fullWidth
                placeholder="请输入角色名称"
                value={name}
                onChange={(event) => onName(event.currentTarget.value)}
              />
              {!editing ? (
                <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
                  新角色默认来源为平台、状态为停用，且不拥有权限。
                </p>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={onClose}>
                取消
              </Button>
              <Button isDisabled={!name.trim() || saving} onPress={onSave}>
                {saving ? "正在保存…" : "确认"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
function RoleDeleteModal({
  role,
  deleting,
  onClose,
  onConfirm,
}: {
  role: Role | null;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      isOpen={role !== null}
      onOpenChange={(open) => !open && !deleting && onClose()}
    >
      <Modal.Backdrop
        className="theme-modal-backdrop"
        isDismissable={!deleting}
      >
        <Modal.Container placement="center" size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>删除角色</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭" />
            </Modal.Header>
            <Modal.Body>
              <p className="">
                确认删除角色「{role?.name}」吗？删除后无法恢复。
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" isDisabled={deleting} onPress={onClose}>
                取消
              </Button>
              <Button isDisabled={deleting} onPress={onConfirm}>
                {deleting ? "正在删除…" : "确认删除"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
function SourceTag({ source }: { source: string }) {
  const ding = source === "dingtalk";
  return (
    <TagGroup aria-label="来源标签">
      <TagGroup.List>
        <Tag className="bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
          {ding ? "钉钉" : "平台"}
        </Tag>
      </TagGroup.List>
    </TagGroup>
  );
}
function StatusTag({ status }: { status: string }) {
  return (
    <TagGroup aria-label="状态标签">
      <TagGroup.List>
        <Tag
          className={`${status === "active" ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]"}`}
        >
          {status === "active" ? "启用" : "停用"}
        </Tag>
      </TagGroup.List>
    </TagGroup>
  );
}

function IconAction({
  title,
  disabled,
  danger = false,
  onPress,
  children,
}: {
  title: string;
  disabled: boolean;
  danger?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <span className="group relative">
      <Button
        aria-label={title}
        variant="ghost"
        isDisabled={disabled}
        onPress={onPress}
        className={`h-8 min-w-8 p-1.5 ${danger ? "text-[var(--color-danger)]" : "text-[var(--color-text-secondary)]"}`}
      >
        {children}
      </Button>
      <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--color-text-primary)] px-2 py-1 text-[11px] text-[var(--color-text-on-primary)] opacity-0 group-hover:opacity-100">
        {title}
      </span>
    </span>
  );
}
function EditIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="m4 16.5-.8 4.3 4.3-.8L18.7 8.8a2.3 2.3 0 0 0-3.3-3.3L4 16.5Z" />
      <path d="m13.8 7.2 3 3" />
    </svg>
  );
}
function EnableIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v10M7 12h10" />
    </svg>
  );
}
function DisableIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M4.5 7h15M9 7V4.5h6V7m-8.5 0 .7 13h9.6l.7-13" />
    </svg>
  );
}
