"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, Button, Checkbox, Input, Modal } from "@heroui/react";

type ApiEnvelope<T> = { code: number; message: string; data: T | null };
type EmailAddressItem = { label: string; email: string };
type RoleItem = {
  id: string;
  username: string | null;
  password: string | null;
  name: string;
  sourceType: string;
  status: string;
};
type UserItem = {
  id: string;
  username: string | null;
  password: string | null;
  displayName: string;
  mobile: string | null;
  stateCode: string | null;
  telephone: string | null;
  email: string | null;
  emailAddresses: EmailAddressItem[];
  avatarUrl: string | null;
  jobNumber: string | null;
  title: string | null;
  workPlace: string | null;
  remark: string | null;
  hiredAt: string | null;
  tenureMonths: number | null;
  managerName: string | null;
  primaryDepartment: string | null;
  senior: boolean;
  isAdmin: boolean;
  isBoss: boolean;
  realAuthed: boolean;
  extensionJson: unknown;
  status: string;
  sourceType: string;
  departments: string[];
  roles: string[];
  roleIds: string[];
};
type SourceFilter = "all" | "local" | "dingtalk";
type StatusFilter = "all" | "active" | "inactive";

export default function UsersSettingsPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [deleting, setDeleting] = useState<UserItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editMobile, setEditMobile] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editTelephone, setEditTelephone] = useState("");
  const [editJobNumber, setEditJobNumber] = useState("");
  const [editWorkPlace, setEditWorkPlace] = useState("");
  const [editRemark, setEditRemark] = useState("");
  const [editEmailAddresses, setEditEmailAddresses] = useState<
    EmailAddressItem[]
  >([]);
  const [editRoleIds, setEditRoleIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRoleIds, setNewRoleIds] = useState<string[]>([]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [response, rolesResponse] = await Promise.all([
        fetch("/api/identity/users", { cache: "no-store" }),
        fetch("/api/identity/roles", { cache: "no-store" }),
      ]);
      const payload = (await response.json()) as ApiEnvelope<UserItem[]>;
      const rolesPayload = (await rolesResponse.json()) as ApiEnvelope<
        RoleItem[]
      >;
      if (!response.ok || payload.code !== 0 || !payload.data)
        throw new Error(payload.message || "无法加载用户");
      if (!rolesResponse.ok || rolesPayload.code !== 0 || !rolesPayload.data)
        throw new Error(rolesPayload.message || "无法加载角色");
      setUsers(payload.data);
      setRoles(rolesPayload.data.filter((role) => role.status === "active"));
      setSelectedId((current) =>
        current && payload.data!.some((user) => user.id === current)
          ? current
          : payload.data![0]?.id || null,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法加载用户");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return users.filter((user) => {
      if (sourceFilter !== "all" && user.sourceType !== sourceFilter)
        return false;
      if (statusFilter !== "all" && user.status !== statusFilter) return false;
      if (!normalized) return true;
      return [
        user.displayName,
        user.mobile,
        user.email,
        user.jobNumber,
        user.title,
        ...user.departments,
        ...user.roles,
      ]
        .filter(Boolean)
        .some((value) =>
          value!.toLocaleLowerCase("zh-CN").includes(normalized),
        );
    });
  }, [query, sourceFilter, statusFilter, users]);
  const selectedUser = users.find((user) => user.id === selectedId) || null;
  function openEdit(user: UserItem) {
    setEditing(user);
    setEditName(user.displayName);
    setEditTitle(user.title ?? "");
    setEditMobile(user.mobile ?? "");
    setEditEmail(user.email ?? "");
    setEditTelephone(user.telephone ?? "");
    setEditJobNumber(user.jobNumber ?? "");
    setEditWorkPlace(user.workPlace ?? "");
    setEditRemark(user.remark ?? "");
    setEditEmailAddresses(user.emailAddresses ?? []);
    setEditRoleIds(
      (user.roleIds ?? []).filter((roleId) =>
        roles.some((role) => role.id === roleId && role.sourceType === user.sourceType),
      ),
    );
  }
  async function update(user: UserItem, payload: object) {
    try {
      const response = await fetch(
        `/api/identity/users/${encodeURIComponent(user.id)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok) throw new Error(body.message || "更新用户失败");
      await loadUsers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "更新用户失败");
    }
  }
  async function saveEdit() {
    if (!editing || !editName.trim()) return;
    const hasInvalidEmail = editEmailAddresses.some(
      (item) => !item.label.trim() || !item.email.trim(),
    );
    if (hasInvalidEmail) {
      setError("请完整填写每个附加邮箱的名称和地址");
      return;
    }
    await update(editing, {
      displayName: editName,
      title: editTitle,
      mobile: editMobile,
      telephone: editTelephone,
      email: editEmail,
      jobNumber: editJobNumber,
      workPlace: editWorkPlace,
      remark: editRemark,
      emailAddresses: editEmailAddresses,
      roleIds: editRoleIds,
    });
    setEditing(null);
  }
  async function remove(user: UserItem) {
    try {
      const response = await fetch(
        `/api/identity/users/${encodeURIComponent(user.id)}`,
        { method: "DELETE" },
      );
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok) throw new Error(body.message || "删除用户失败");
      await loadUsers();
      setDeleting(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除用户失败");
    }
  }
  async function createUser() {
    if (!newUsername.trim() || !newPassword || !newName.trim()) {
      setError("请填写账号、密码和姓名");
      return;
    }
    try {
      const response = await fetch("/api/identity/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          displayName: newName,
          roleIds: newRoleIds,
        }),
      });
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok) throw new Error(body.message || "创建用户失败");
      setCreating(false);
      setNewUsername("");
      setNewPassword("");
      setNewName("");
      setNewRoleIds([]);
      await loadUsers();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建用户失败");
    }
  }

  return (
    <section className="theme-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] shadow-[var(--shadow-card)]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              用户管理
            </h2>
            <span className="rounded-full bg-[var(--color-success-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-success)]">
              公开注册已关闭
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            共 {users.length} 人 · 启用{" "}
            {users.filter((user) => user.status === "active").length} 人 · 钉钉{" "}
            {users.filter((user) => user.sourceType === "dingtalk").length} 人
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            aria-label="搜索用户"
            className="w-64"
            placeholder="搜索姓名、部门、角色或手机号"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <Button variant="secondary" onPress={() => setCreating(true)}>
            添加用户
          </Button>
          <Button
            variant="secondary"
            isDisabled={loading}
            onPress={() => void loadUsers()}
          >
            <RefreshIcon />
            {loading ? "刷新中…" : "刷新"}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mx-5 mt-4 rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex overflow-hidden">
          <div className="settings-scroll-area h-full w-[180px] shrink-0 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-control-soft)] p-3 overscroll-contain">
            <FilterGroup label="用户来源">
              <FilterButton
                label="全部用户"
                count={users.length}
                active={sourceFilter === "all"}
                onPress={() => setSourceFilter("all")}
              />
              <FilterButton
                label="平台账号"
                count={
                  users.filter((user) => user.sourceType === "local").length
                }
                active={sourceFilter === "local"}
                onPress={() => setSourceFilter("local")}
              />
              <FilterButton
                label="钉钉"
                count={
                  users.filter((user) => user.sourceType === "dingtalk").length
                }
                active={sourceFilter === "dingtalk"}
                onPress={() => setSourceFilter("dingtalk")}
              />
            </FilterGroup>
            <FilterGroup label="账号状态">
              <FilterButton
                label="全部状态"
                count={users.length}
                active={statusFilter === "all"}
                onPress={() => setStatusFilter("all")}
              />
              <FilterButton
                label="已启用"
                count={users.filter((user) => user.status === "active").length}
                active={statusFilter === "active"}
                onPress={() => setStatusFilter("active")}
              />
              <FilterButton
                label="已停用"
                count={users.filter((user) => user.status !== "active").length}
                active={statusFilter === "inactive"}
                onPress={() => setStatusFilter("inactive")}
              />
            </FilterGroup>
          </div>

          <div className="settings-scroll-area h-full min-h-0 min-w-0 flex-1 overflow-y-scroll overscroll-contain">
            <div className="sticky top-0 z-10 grid min-w-[1120px] grid-cols-[minmax(180px,1.15fr)_110px_110px_80px_minmax(150px,1fr)_minmax(150px,1fr)_90px_110px] gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-3 text-xs font-semibold text-[var(--color-text-secondary)]">
              <div>用户</div>
              <div>账号</div>
              <div>密码</div>
              <div>来源</div>
              <div>组织</div>
              <div>角色</div>
              <div>状态</div>
              <div>操作</div>
            </div>
            {filteredUsers.map((user) => (
              <div
                role="button"
                tabIndex={0}
                key={user.id}
                className={`grid min-w-[1120px] grid-cols-[minmax(180px,1.15fr)_110px_110px_80px_minmax(150px,1fr)_minmax(150px,1fr)_90px_110px] items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 text-left ${selectedId === user.id ? "bg-[var(--color-primary-soft)]" : "hover:bg-[var(--color-bg-hover)]"}`}
                onClick={() => setSelectedId(user.id)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <UserAvatar user={user} size="sm" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                      {user.displayName}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-secondary)]">
                      {user.title ||
                        user.mobile ||
                        user.email ||
                        user.jobNumber ||
                        "—"}
                    </div>
                  </div>
                </div>
                <div className="truncate text-xs text-[var(--color-text-primary)]">
                  {user.username || "—"}
                </div>
                <div className="truncate text-xs text-[var(--color-text-primary)]">
                  {user.password || "—"}
                </div>
                <div>
                  <SourceTag source={user.sourceType} />
                </div>
                <TagList values={user.departments} empty="未分配组织" />
                <TagList values={user.roles} empty="未分配角色" />
                <span
                  className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-semibold ${user.status === "active" ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-control-soft)] text-[var(--color-text-disabled)]"}`}
                >
                  {user.status === "active" ? "已启用" : "已停用"}
                </span>
                <div
                  className="flex gap-1"
                  onClick={(event) => event.stopPropagation()}
                >
                  <UserIconAction
                    title="编辑用户"
                    onClick={() => openEdit(user)}
                  >
                    <EditIcon />
                  </UserIconAction>
                  <UserIconAction
                    title={user.status === "active" ? "禁用用户" : "启用用户"}
                    onClick={() =>
                      void update(user, {
                        status:
                          user.status === "active" ? "inactive" : "active",
                      })
                    }
                  >
                    {user.status === "active" ? (
                      <DisableIcon />
                    ) : (
                      <EnableIcon />
                    )}
                  </UserIconAction>
                  <UserIconAction
                    title="删除用户"
                    danger
                    onClick={() => setDeleting(user)}
                  >
                    <TrashIcon />
                  </UserIconAction>
                </div>
              </div>
            ))}
            {!loading && filteredUsers.length === 0 ? (
              <div className="flex min-h-64 items-center justify-center text-sm text-[var(--color-text-secondary)]">
                没有符合当前条件的用户。
              </div>
            ) : null}
          </div>
          <aside className="settings-scroll-area h-full w-[300px] shrink-0 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-control-soft)] p-5 overscroll-contain">
            {selectedUser ? (
              <UserDetails user={selectedUser} />
            ) : (
              <div className="text-sm text-[var(--color-text-secondary)]">
                选择一个用户查看完整资料。
              </div>
            )}
          </aside>
        </div>
      </div>
      <Modal
        isOpen={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" size="lg">
            <Modal.Dialog className="max-h-[calc(100dvh-2rem)] overflow-hidden rounded-2xl bg-[var(--color-bg-surface)]">
              <Modal.Header>
                <Modal.Heading>编辑用户</Modal.Heading>
                <Modal.CloseTrigger aria-label="关闭" />
              </Modal.Header>
              <Modal.Body className="max-h-[70vh] min-h-0 space-y-5 overflow-y-auto overscroll-contain">
                <div>
                  <p className="mb-2 text-xs font-semibold text-[var(--color-text-secondary)]">
                    可维护资料
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      aria-label="姓名"
                      fullWidth
                      placeholder="姓名"
                      value={editName}
                      onChange={(event) =>
                        setEditName(event.currentTarget.value)
                      }
                    />
                    <Input
                      aria-label="职位"
                      fullWidth
                      placeholder="职位"
                      value={editTitle}
                      onChange={(event) =>
                        setEditTitle(event.currentTarget.value)
                      }
                    />
                    <Input
                      aria-label="手机号"
                      fullWidth
                      placeholder="手机号"
                      value={editMobile}
                      onChange={(event) =>
                        setEditMobile(event.currentTarget.value)
                      }
                    />
                    <Input
                      aria-label="分机号"
                      fullWidth
                      placeholder="分机号"
                      value={editTelephone}
                      onChange={(event) =>
                        setEditTelephone(event.currentTarget.value)
                      }
                    />
                    <Input
                      aria-label="工号"
                      fullWidth
                      placeholder="工号"
                      value={editJobNumber}
                      onChange={(event) =>
                        setEditJobNumber(event.currentTarget.value)
                      }
                    />
                    <Input
                      aria-label="办公地点"
                      fullWidth
                      placeholder="办公地点"
                      value={editWorkPlace}
                      onChange={(event) =>
                        setEditWorkPlace(event.currentTarget.value)
                      }
                    />
                    <div className="col-span-2">
                      <Input
                        aria-label="主邮箱"
                        fullWidth
                        placeholder="主邮箱"
                        type="email"
                        value={editEmail}
                        onChange={(event) =>
                          setEditEmail(event.currentTarget.value)
                        }
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        aria-label="备注"
                        fullWidth
                        placeholder="备注"
                        value={editRemark}
                        onChange={(event) =>
                          setEditRemark(event.currentTarget.value)
                        }
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-2 rounded-xl border border-[var(--color-border)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-[var(--color-text-primary)]">
                        附加邮箱
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                        可为用户登记多个手动维护的邮箱。
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() =>
                        setEditEmailAddresses((items) => [
                          ...items,
                          { label: "", email: "" },
                        ])
                      }
                    >
                      添加邮箱
                    </Button>
                  </div>
                  {editEmailAddresses.map((item, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        aria-label={`邮箱名称 ${index + 1}`}
                        className="w-32 shrink-0"
                        placeholder="邮箱名称"
                        value={item.label}
                        onChange={(event) => {
                          const label = event.currentTarget.value;
                          setEditEmailAddresses((items) =>
                            items.map((current, currentIndex) =>
                              currentIndex === index
                                ? {
                                    ...current,
                                    label,
                                  }
                                : current,
                            ),
                          );
                        }}
                      />
                      <Input
                        aria-label={`邮箱地址 ${index + 1}`}
                        className="min-w-0 flex-1"
                        placeholder="name@example.com"
                        type="email"
                        value={item.email}
                        onChange={(event) => {
                          const email = event.currentTarget.value;
                          setEditEmailAddresses((items) =>
                            items.map((current, currentIndex) =>
                              currentIndex === index
                                ? {
                                    ...current,
                                    email,
                                  }
                                : current,
                            ),
                          );
                        }}
                      />
                      <Button
                        aria-label={`删除邮箱 ${index + 1}`}
                        isIconOnly
                        variant="ghost"
                        className="text-[var(--color-danger)]"
                        onPress={() =>
                          setEditEmailAddresses((items) =>
                            items.filter(
                              (_, currentIndex) => currentIndex !== index,
                            ),
                          )
                        }
                      >
                        <TrashIcon />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-[var(--color-border)] p-3">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    用户角色
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                    可添加或移除多个角色，角色权限会取并集。
                  </p>
                  <RoleMultiSelect
                    roles={roles.filter(
                      (role) => role.sourceType === editing?.sourceType,
                    )}
                    value={editRoleIds}
                    onChange={setEditRoleIds}
                  />
                </div>
                {editing ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold text-[var(--color-text-secondary)]">
                      身份源资料（只读）
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-[var(--color-control-soft)] p-3">
                      <ReadOnlyField
                        label="头像 URL"
                        value={editing.avatarUrl}
                      />
                      <ReadOnlyField
                        label="手机号区号"
                        value={editing.stateCode}
                      />
                      <ReadOnlyField
                        label="主部门"
                        value={editing.primaryDepartment}
                      />
                      <ReadOnlyField
                        label="直属主管"
                        value={editing.managerName}
                      />
                      <ReadOnlyField
                        label="角色"
                        value={editing.roles.join("、") || null}
                      />
                      <ReadOnlyField
                        label="全部部门"
                        value={editing.departments.join("、") || null}
                      />
                      <ReadOnlyField
                        label="入职时间"
                        value={
                          editing.hiredAt
                            ? new Date(editing.hiredAt).toLocaleDateString(
                                "zh-CN",
                              )
                            : null
                        }
                      />
                      <ReadOnlyField
                        label="司龄"
                        value={formatTenure(editing.tenureMonths)}
                      />
                      <ReadOnlyField
                        label="实名状态"
                        value={editing.realAuthed ? "已实名" : "未实名"}
                      />
                      <ReadOnlyField
                        label="职级"
                        value={findExtensionValue(editing.extensionJson, [
                          "职级",
                          "jobLevel",
                          "job_level",
                        ])}
                      />
                    </div>
                  </div>
                ) : null}
                <p className="text-xs text-[var(--color-text-secondary)]">
                  主邮箱和可维护资料会在钉钉对应字段非空时同步覆盖；附加邮箱为平台手动维护，不会被钉钉同步清空。
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setEditing(null)}>
                  取消
                </Button>
                <Button
                  isDisabled={!editName.trim()}
                  onPress={() => void saveEdit()}
                >
                  保存
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal
        isOpen={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog className="rounded-2xl bg-[var(--color-bg-surface)]">
              <Modal.Header>
                <Modal.Heading>删除用户</Modal.Heading>
                <Modal.CloseTrigger aria-label="关闭" />
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
                  确认删除用户「{deleting?.displayName}」吗？删除后无法恢复。
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setDeleting(null)}>
                  取消
                </Button>
                <Button
                  className="bg-[var(--color-danger)] text-white"
                  onPress={() => deleting && void remove(deleting)}
                >
                  确认删除
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal isOpen={creating} onOpenChange={setCreating}>
        <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog className="rounded-2xl bg-[var(--color-bg-surface)]">
              <Modal.Header>
                <Modal.Heading>添加平台用户</Modal.Heading>
                <Modal.CloseTrigger aria-label="关闭" />
              </Modal.Header>
              <Modal.Body className="space-y-3">
                <Input
                  aria-label="账号"
                  placeholder="账号"
                  value={newUsername}
                  onChange={(event) =>
                    setNewUsername(event.currentTarget.value)
                  }
                />
                <Input
                  aria-label="密码"
                  placeholder="密码"
                  value={newPassword}
                  onChange={(event) =>
                    setNewPassword(event.currentTarget.value)
                  }
                />
                <Input
                  aria-label="姓名"
                  placeholder="姓名"
                  value={newName}
                  onChange={(event) => setNewName(event.currentTarget.value)}
                />
                <div className="rounded-xl border border-[var(--color-border)] p-3">
                  <p className="text-sm font-medium">用户角色</p>
                  <RoleMultiSelect
                    roles={roles.filter((role) => role.sourceType === "local")}
                    value={newRoleIds}
                    onChange={setNewRoleIds}
                  />
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setCreating(false)}>
                  取消
                </Button>
                <Button onPress={() => void createUser()}>创建用户</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </section>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="mb-2 px-2 text-[11px] font-semibold text-[var(--color-text-secondary)]">
        {label}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function RoleMultiSelect({
  roles,
  value,
  onChange,
}: {
  roles: RoleItem[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = roles.filter((role) => value.includes(role.id));
  const visible = roles.filter((role) =>
    role.name
      .toLocaleLowerCase("zh-CN")
      .includes(query.toLocaleLowerCase("zh-CN")),
  );
  return (
      <details className="mt-3">
      <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
        <span className="truncate">
          {selected.length
            ? selected.map((role) => role.name).join("、")
            : "选择角色"}
        </span>
        <span className="ml-2 text-[var(--color-text-secondary)]">⌄</span>
      </summary>
      <div className="mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-2 shadow-[var(--shadow-card)]">
        <Input
          aria-label="搜索角色"
          placeholder="搜索角色"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />{" "}
        <div className="mt-2 max-h-44 space-y-1 overflow-y-auto overscroll-contain">
          {visible.map((role) => (
            <Checkbox
              key={role.id}
              isSelected={value.includes(role.id)}
              onChange={() =>
                onChange(
                  value.includes(role.id)
                    ? value.filter((id) => id !== role.id)
                    : [...value, role.id],
                )
              }
              className="w-full rounded-lg px-2 py-1.5"
            >
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Checkbox.Content>{role.name}</Checkbox.Content>
            </Checkbox>
          ))}
          {!visible.length ? (
            <p className="px-2 py-3 text-xs text-[var(--color-text-secondary)]">
              未找到角色
            </p>
          ) : null}
        </div>
      </div>
    </details>
  );
}
function FilterButton({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      fullWidth
      variant="ghost"
      className={`justify-between rounded-xl px-3 ${active ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "text-[var(--color-text-primary)]"}`}
      onPress={onPress}
    >
      <span>{label}</span>
      <span className="text-xs opacity-65">{count}</span>
    </Button>
  );
}
function TagList({ values, empty }: { values: string[]; empty: string }) {
  return values.length ? (
    <div className="flex min-w-0 flex-wrap gap-1">
      {values.slice(0, 2).map((value) => (
        <span
          key={value}
          className="max-w-36 truncate rounded-lg bg-[var(--color-control-soft)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)]"
        >
          {value}
        </span>
      ))}
      {values.length > 2 ? (
        <span className="rounded-lg bg-[var(--color-control-soft)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)]">
          +{values.length - 2}
        </span>
      ) : null}
    </div>
  ) : (
    <span className="text-xs text-[var(--color-text-disabled)]">{empty}</span>
  );
}
function SourceTag({ source }: { source: string }) {
  return source === "dingtalk" ? (
    <span className="shrink-0 rounded-full bg-[#eaf2ff] px-2 py-0.5 text-[10px] font-semibold text-[#1677ff]">
      钉钉
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-[#f5f5f5] px-2 py-0.5 text-[10px] font-semibold text-[#595959]">
      平台
    </span>
  );
}

function UserDetails({ user }: { user: UserItem }) {
  return (
    <>
      <UserAvatar user={user} size="lg" />
      <div className="mt-4 flex items-center gap-2">
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
          {user.displayName}
        </h3>
        <SourceTag source={user.sourceType} />
      </div>
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
        {user.title || "未设置职位"}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
        <Detail label="主邮箱" value={user.email} />
        <Detail label="头像 URL" value={user.avatarUrl} />
        <Detail
          label="手机号"
          value={
            [user.stateCode, user.mobile].filter(Boolean).join("-") || null
          }
        />
        <Detail label="主部门" value={user.primaryDepartment} />
        <Detail label="直属主管" value={user.managerName} />
        <Detail label="职务" value={user.roles.join("、") || null} />
        <Detail label="职位" value={user.title} />
        <Detail
          label="职级"
          value={findExtensionValue(user.extensionJson, [
            "职级",
            "jobLevel",
            "job_level",
          ])}
        />
        <Detail
          label="旧职位"
          value={findExtensionValue(user.extensionJson, [
            "职位(升级前字段)",
            "legacyPosition",
            "old_title",
          ])}
        />
        <Detail label="工号" value={user.jobNumber} />
        <Detail label="分机号" value={user.telephone} />
        <Detail label="办公地点" value={user.workPlace} />
        <Detail
          label="入职时间"
          value={
            user.hiredAt
              ? new Date(user.hiredAt).toLocaleDateString("zh-CN")
              : null
          }
        />
        <Detail label="司龄" value={formatTenure(user.tenureMonths)} />
        <Detail
          label="实名状态"
          value={user.realAuthed ? "已实名" : "未实名"}
        />
      </div>
      <div className="mt-4">
        <div className="text-[10px] text-[var(--color-text-disabled)]">
          全部邮箱
        </div>
        <div className="mt-1 space-y-1">
          <div className="flex gap-2 text-xs">
            <span className="shrink-0 text-[var(--color-text-secondary)]">
              主邮箱
            </span>
            <span className="break-all font-medium text-[var(--color-text-primary)]">
              {user.email || "—"}
            </span>
          </div>
          {user.emailAddresses.map((item) => (
            <div
              key={`${item.label}-${item.email}`}
              className="flex gap-2 text-xs"
            >
              <span className="shrink-0 text-[var(--color-text-secondary)]">
                {item.label}
              </span>
              <span className="break-all font-medium text-[var(--color-text-primary)]">
                {item.email}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-5">
        <Detail label="全部部门" value={user.departments.join("、") || null} />
      </div>
      <div className="mt-4">
        <Detail label="备注" value={user.remark} />
      </div>
    </>
  );
}

function UserAvatar({ user, size }: { user: UserItem; size: "sm" | "lg" }) {
  return (
    <Avatar
      size={size}
      className={
        size === "sm" ? "h-9 w-9 shrink-0 text-sm" : "h-12 w-12 text-lg"
      }
    >
      {user.avatarUrl ? <Avatar.Image src={user.avatarUrl} alt="" /> : null}
      <Avatar.Fallback>
        {getAvatarFallbackText(user.displayName)}
      </Avatar.Fallback>
    </Avatar>
  );
}

function getAvatarFallbackText(displayName: string) {
  const characters = Array.from(displayName.trim());
  return characters.length > 2
    ? characters.slice(-2).join("")
    : characters.join("") || "?";
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-[var(--color-text-disabled)]">
        {label}
      </div>
      <div className="mt-1 break-words text-xs font-medium text-[var(--color-text-primary)]">
        {value || "—"}
      </div>
    </div>
  );
}
function ReadOnlyField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-[var(--color-text-disabled)]">
        {label}
      </div>
      <div className="mt-1 break-words text-xs font-medium text-[var(--color-text-primary)]">
        {value || "—"}
      </div>
    </div>
  );
}
function formatTenure(months: number | null) {
  if (months === null) return null;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return years > 0 ? `${years}年${rest}月` : `${rest}月`;
}
function findExtensionValue(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      keys.some(
        (candidate) =>
          candidate.toLocaleLowerCase() === key.toLocaleLowerCase(),
      ) &&
      (typeof item === "string" || typeof item === "number")
    )
      return String(item);
    const nested = findExtensionValue(item, keys);
    if (nested) return nested;
  }
  return null;
}
function UserIconAction({
  title,
  danger = false,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <span className="group relative">
      <Button
        aria-label={title}
        variant="ghost"
        onPress={onClick}
        className={`h-8 min-w-8 p-1.5 ${danger ? "text-[var(--color-danger)]" : "text-[var(--color-text-secondary)]"}`}
      >
        {children}
      </Button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1 text-[11px] text-[var(--color-text-primary)] shadow-[var(--shadow-card)] opacity-0 transition group-hover:opacity-100">
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
function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M20 11a8 8 0 1 0 2 5.3" />
      <path d="M20 4v7h-7" />
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
