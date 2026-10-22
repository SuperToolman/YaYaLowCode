"use client";
import { notifyRequestError } from "@lib/notify";
import { useAuth } from "@components/AuthProvider";

import { DisplayTag } from "@shared/DisplayTag";

import { useMemo, useState } from "react";
import { notify } from "@lib/notify";
import {
  UserEditorModal,
  type UserEditorValues,
} from "./components/UserEditorModal";
import { SourceTag, UserAvatar } from "./components/UserIdentity";
import {
  Alert,
  Card,
  Button,
  ButtonGroup,
  Dropdown,
  Modal,
  Popover,
  SearchField,
  Table,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@heroui/react";
import {
  type UpdateUserRequest,
  toUpdateUserRequest,
  initializeUserCredentials,
  useUserManagement,
} from "@features/identity-access";
import {
  ArrowRotateRight,
  CircleInfo,
  Ellipsis,
  Key,
  Plus,
} from "@gravity-ui/icons";
import { filterUsers, type UserItem } from "@features/identity-access";

type SourceFilter = "all" | "local" | "dingtalk";
type StatusFilter = "all" | "active" | "inactive";
type CredentialInitializationResult = {
  initialized: number;
  alreadyConfigured: number;
  skipped: Array<{ userId: string; displayName: string; reason: string }>;
};

export default function UsersSettingsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("settings.users.manage");
  const canInitialize = hasPermission("*");
  const userManagement = useUserManagement();
  const {
    users,
    roles,
    loading,
    error: remoteError,
    reload: loadUsers,
  } = userManagement;
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editor, setEditor] = useState<
    { mode: "create" } | { mode: "edit"; user: UserItem } | null
  >(null);
  const [deleting, setDeleting] = useState<UserItem | null>(null);
  const [initializingCredentials, setInitializingCredentials] = useState(false);
  const [credentialInitializationResult, setCredentialInitializationResult] =
    useState<CredentialInitializationResult | null>(null);

  const filteredUsers = useMemo(
    () => filterUsers(users, query, sourceFilter, statusFilter),
    [query, sourceFilter, statusFilter, users],
  );
  function openEdit(user: UserItem) {
    setEditor({ mode: "edit", user });
  }
  async function update(
    user: UserItem,
    payload: UpdateUserRequest,
  ): Promise<boolean> {
    setError("");
    try {
      await userManagement.update(user.id, payload);
      notify.success("用户信息已更新");
      return true;
    } catch (reason) {
      notifyRequestError(reason, "更新用户失败", {
        description: reason instanceof Error ? reason.message : "请稍后重试",
      });
      return false;
    }
  }
  async function remove(user: UserItem) {
    setError("");
    try {
      await userManagement.remove(user.id);
      setDeleting(null);
      notify.success("用户已删除");
    } catch (reason) {
      notifyRequestError(reason, "删除用户失败", {
        description: reason instanceof Error ? reason.message : "请稍后重试",
      });
    }
  }
  async function saveUser(values: UserEditorValues) {
    const { username, password, ...profile } = values;
    const payload = toUpdateUserRequest(profile);
    if (editor?.mode === "edit") {
      await userManagement.update(editor.user.id, payload);
      notify.success("用户信息已更新");
      return;
    }
    await userManagement.create({
      ...profile,
      displayName: profile.displayName.trim(),
      roleIds: [...new Set(profile.roleIds)],
      username,
      password,
    });
    notify.success("用户已创建");
  }
  async function initializeCredentials() {
    setInitializingCredentials(true);
    setError("");
    try {
      const result = await initializeUserCredentials();
      setCredentialInitializationResult(result);
      await loadUsers();
      notify.success("账号密码初始化完成");
    } catch (reason) {
      notifyRequestError(reason, "初始化账号密码失败", {
        description: reason instanceof Error ? reason.message : "请稍后重试",
      });
    } finally {
      setInitializingCredentials(false);
    }
  }

  return (
    <Card style={{ height: "100%", minHeight: 0, overflow: "clip" }}>
      <Card.Header
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexShrink: 0,
        }}
      >
        <div>
          <Card.Title>用户管理</Card.Title>
          <Card.Description>
            管理平台账号与组织身份源。共 {users.length} 人，其中{" "}
            {users.filter((user) => user.status === "active").length} 人已启用。
          </Card.Description>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <SearchField aria-label="搜索用户" value={query} onChange={setQuery}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="搜索姓名、部门、角色或手机号" />
              <SearchField.ClearButton aria-label="清除用户搜索" />
            </SearchField.Group>
          </SearchField>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ButtonGroup aria-label="用户管理操作" variant="secondary">
              <Button isDisabled={loading} onPress={() => void loadUsers()}>
                <ArrowRotateRight aria-hidden="true" />
                {loading ? "刷新中…" : "刷新"}
              </Button>
              <Button isDisabled={!canManage}
                variant="primary"
                onPress={() => setEditor({ mode: "create" })}
              >
                <Plus aria-hidden="true" />
                添加
              </Button>
              <Button
                isDisabled={!canInitialize || loading || initializingCredentials}
                onPress={() => void initializeCredentials()}
              >
                <Key aria-hidden="true" />
                {initializingCredentials ? "正在初始化…" : "初始化账号密码"}
              </Button>
            </ButtonGroup>
            <Popover>
              <Button
                isIconOnly
                variant="ghost"
                aria-label="账号密码初始化规则"
              >
                <CircleInfo aria-hidden="true" />
              </Button>
              <Popover.Content>
                <Popover.Arrow />
                <Popover.Dialog aria-label="账号密码初始化规则">
                  <Popover.Heading>账号密码初始化规则</Popover.Heading>
                  <div style={{ display: "grid", gap: 6, maxWidth: 256 }}>
                    <Typography>仅处理尚未设置账号密码的用户。</Typography>
                    <Typography>有主邮箱：邮箱同时作为账号和密码。</Typography>
                    <Typography>
                      无主邮箱但有手机号：手机号同时作为账号和密码。
                    </Typography>
                    <Typography>两者均无则跳过，并在结果中列出。</Typography>
                  </div>
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
          </div>
        </div>
      </Card.Header>
      <Card.Content
        style={{
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          gap: 16,
        }}
      >
        {error || remoteError ? (
          <Alert>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{error || remoteError}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
          }}
        >
          <ToggleButtonGroup
            aria-label="用户来源"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[sourceFilter]}
            onSelectionChange={(keys) => {
              const selected = (["all", "local", "dingtalk"] as const).find(
                (key) => keys.has(key),
              );
              if (selected) setSourceFilter(selected);
            }}
          >
            <ToggleButton id="all">
              全部用户 <DisplayTag>{users.length}</DisplayTag>
            </ToggleButton>
            <ToggleButton id="local">
              平台{" "}
              <DisplayTag color="warning">
                {users.filter((user) => user.sourceType === "local").length}
              </DisplayTag>
            </ToggleButton>
            <ToggleButton id="dingtalk">
              钉钉{" "}
              <DisplayTag color="accent">
                {users.filter((user) => user.sourceType === "dingtalk").length}
              </DisplayTag>
            </ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup
            aria-label="账号状态"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[statusFilter]}
            onSelectionChange={(keys) => {
              const selected = (["all", "active", "inactive"] as const).find(
                (key) => keys.has(key),
              );
              if (selected) setStatusFilter(selected);
            }}
          >
            <ToggleButton id="all">
              全部状态 <DisplayTag>{users.length}</DisplayTag>
            </ToggleButton>
            <ToggleButton id="active">
              已启用{" "}
              <DisplayTag color="success">
                {users.filter((user) => user.status === "active").length}
              </DisplayTag>
            </ToggleButton>
            <ToggleButton id="inactive">
              已停用{" "}
              <DisplayTag color="danger">
                {users.filter((user) => user.status === "inactive").length}
              </DisplayTag>
            </ToggleButton>
          </ToggleButtonGroup>
        </div>
        <Table>
          <Table.ScrollContainer style={{ overflowX: "auto" }}>
            <Table.Content
              aria-label="用户列表"
              style={{ minWidth: 940, width: "100%", tableLayout: "fixed" }}
            >
              <Table.Header>
                <Table.Column id="user" isRowHeader>
                  用户
                </Table.Column>
                <Table.Column id="department">组织</Table.Column>
                <Table.Column id="roles">角色</Table.Column>
                <Table.Column id="contact">联系方式</Table.Column>
                <Table.Column id="source" style={{ width: 96 }}>
                  来源
                </Table.Column>
                <Table.Column id="status" style={{ width: 112 }}>
                  状态
                </Table.Column>
                <Table.Column id="actions" style={{ width: 72 }}>
                  操作
                </Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <Typography>
                    {loading ? "正在加载用户…" : "没有符合当前条件的用户。"}
                  </Typography>
                )}
              >
                <Table.Collection items={filteredUsers}>
                  {(user) => (
                    <Table.Row key={user.id} id={user.id}>
                      <Table.Cell>
                        <div
                          style={{
                            display: "flex",
                            minWidth: 0,
                            alignItems: "center",
                            gap: 12,
                          }}
                        >
                          <UserAvatar user={user} />
                          <div style={{ minWidth: 0 }}>
                            <Typography truncate>{user.displayName}</Typography>
                            <Typography truncate>
                              {user.title || user.jobNumber || "未设置职位"}
                            </Typography>
                          </div>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <TagList values={user.departments} empty="未分配组织" />
                      </Table.Cell>
                      <Table.Cell>
                        <TagList values={user.roles} empty="未分配角色" />
                      </Table.Cell>
                      <Table.Cell>
                        <div style={{ minWidth: 0 }}>
                          <Typography truncate>
                            {user.mobile || "未设置手机号"}
                          </Typography>
                          <Typography truncate>
                            {user.email || "未设置邮箱"}
                          </Typography>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <SourceTag source={user.sourceType} />
                      </Table.Cell>
                      <Table.Cell>
                        <DisplayTag
                          color={
                            user.status === "active" ? "success" : "danger"
                          }
                        >
                          {user.status === "active" ? "已启用" : "已停用"}
                        </DisplayTag>
                      </Table.Cell>
                      <Table.Cell>
                        <UserActions
                          canManage={canManage}
                          user={user}
                          onEdit={openEdit}
                          onToggle={(target) =>
                            void update(target, {
                              status:
                                target.status === "active"
                                  ? "inactive"
                                  : "active",
                            })
                          }
                          onDelete={setDeleting}
                        />
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Collection>
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Card.Content>
      {editor ? (
        <UserEditorModal
          key={editor.mode === "edit" ? editor.user.id : "create"}
          user={editor.mode === "edit" ? editor.user : null}
          roles={roles}
          onClose={() => setEditor(null)}
          onSubmit={saveUser}
        />
      ) : null}
      <Modal
        isOpen={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <Modal.Backdrop isDismissable>
          <Modal.Container placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>删除用户</Modal.Heading>
                <Modal.CloseTrigger aria-label="关闭" />
              </Modal.Header>
              <Modal.Body>
                <Typography>
                  确认删除用户「{deleting?.displayName}」吗？删除后无法恢复。
                </Typography>
              </Modal.Body>
              <Modal.Footer>
                <Button isDisabled={!canManage} onPress={() => setDeleting(null)}>取消</Button>
                <Button isDisabled={!canManage} onPress={() => deleting && void remove(deleting)}>
                  确认删除
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal
        isOpen={credentialInitializationResult !== null}
        onOpenChange={(open) =>
          !open && setCredentialInitializationResult(null)
        }
      >
        <Modal.Backdrop isDismissable>
          <Modal.Container placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>账号密码初始化结果</Modal.Heading>
                <Modal.CloseTrigger aria-label="关闭" />
              </Modal.Header>
              <Modal.Body style={{ display: "grid", gap: 16 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 12,
                  }}
                >
                  <Card>
                    <Typography>已初始化</Typography>
                    <Typography>
                      {credentialInitializationResult?.initialized ?? 0}
                    </Typography>
                  </Card>
                  <Card>
                    <Typography>原本已有账号密码</Typography>
                    <Typography>
                      {credentialInitializationResult?.alreadyConfigured ?? 0}
                    </Typography>
                  </Card>
                </div>
                {credentialInitializationResult?.skipped.length ? (
                  <div>
                    <Typography>
                      已跳过 {credentialInitializationResult.skipped.length}{" "}
                      位用户
                    </Typography>
                    <div
                      style={{
                        maxHeight: 208,
                        display: "grid",
                        gap: 8,
                        overflowY: "auto",
                      }}
                    >
                      {credentialInitializationResult.skipped.map((item) => (
                        <div
                          key={item.userId}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                          }}
                        >
                          <span>{item.displayName}</span>
                          <span>{item.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Typography>没有需要跳过的用户。</Typography>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button onPress={() => setCredentialInitializationResult(null)}>
                  完成
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </Card>
  );
}

function UserActions({
  canManage,
  user,
  onEdit,
  onToggle,
  onDelete,
}: {
  canManage: boolean;
  user: UserItem;
  onEdit: (user: UserItem) => void;
  onToggle: (user: UserItem) => void;
  onDelete: (user: UserItem) => void;
}) {
  return (
    <Dropdown>
      <Button
        isIconOnly
        variant="ghost"
        aria-label={`${user.displayName}更多操作`}
      >
        <Ellipsis aria-hidden="true" />
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu aria-label={`${user.displayName}操作`}>
          <Dropdown.Item id="account" isDisabled>
            账号：{user.username || "未设置"}
          </Dropdown.Item>
          <Dropdown.Item isDisabled={!canManage} id="edit" onAction={() => onEdit(user)}>
            查看并编辑完整资料
          </Dropdown.Item>
          <Dropdown.Item isDisabled={!canManage} id="toggle" onAction={() => onToggle(user)}>
            {user.status === "active" ? "停用用户" : "启用用户"}
          </Dropdown.Item>
          <Dropdown.Item isDisabled={!canManage} id="delete" onAction={() => onDelete(user)}>
            删除用户
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

function TagList({ values, empty }: { values: string[]; empty: string }) {
  return values.length ? (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {values.slice(0, 2).map((value) => (
        <DisplayTag key={value}>{value}</DisplayTag>
      ))}
      {values.length > 2 ? <DisplayTag>+{values.length - 2}</DisplayTag> : null}
    </div>
  ) : (
    <Typography>{empty}</Typography>
  );
}
