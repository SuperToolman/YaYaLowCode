"use client";

import { DisplayTag } from "@shared/DisplayTag";

import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Description,
  InputGroup,
  Label,
  Modal,
  TextField,
  Typography,
} from "@heroui/react";
import { MySurface } from "@shared/ui/MySurface";
import { RoleMultiSelect } from "@shared/RoleMultiSelect";
import {
  validateUserForm,
  type EmailAddressItem,
  type RoleItem,
  type UserFormValues,
  type UserItem,
} from "@features/identity-access";
import { SourceTag, UserAvatar } from "./UserIdentity";
import { AdditionalEmailFields } from "./AdditionalEmailFields";

export type UserEditorValues = UserFormValues & {
  username: string;
  password: string;
};

type UserEditorModalProps = {
  user: UserItem | null;
  roles: RoleItem[];
  onClose: () => void;
  onSubmit: (values: UserEditorValues) => Promise<void>;
};

export function UserEditorModal({
  user,
  roles,
  onClose,
  onSubmit,
}: UserEditorModalProps) {
  const editing = user;
  const [editName, setEditName] = useState(user?.displayName ?? "");
  const [editTitle, setEditTitle] = useState(user?.title ?? "");
  const [editMobile, setEditMobile] = useState(user?.mobile ?? "");
  const [editEmail, setEditEmail] = useState(user?.email ?? "");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [editTelephone, setEditTelephone] = useState(user?.telephone ?? "");
  const [editJobNumber, setEditJobNumber] = useState(user?.jobNumber ?? "");
  const [editWorkPlace, setEditWorkPlace] = useState(user?.workPlace ?? "");
  const [editRemark, setEditRemark] = useState(user?.remark ?? "");
  const [editEmailAddresses, setEditEmailAddresses] = useState<
    EmailAddressItem[]
  >(user?.emailAddresses ?? []);
  const [editRoleIds, setEditRoleIds] = useState<string[]>(
    (user?.roleIds ?? []).filter((id) => roles.some((role) => role.id === id)),
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    const values: UserEditorValues = {
      displayName: editName,
      title: editTitle,
      mobile: editMobile,
      email: editEmail,
      smtpPassword: smtpPassword || undefined,
      telephone: editTelephone,
      jobNumber: editJobNumber,
      workPlace: editWorkPlace,
      remark: editRemark,
      emailAddresses: editEmailAddresses,
      roleIds: editRoleIds,
      username: username.trim(),
      password,
    };
    const validationError = validateUserForm(values);
    if (
      validationError ||
      (!editing && (!values.username || !password.trim()))
    ) {
      setError(validationError || "请填写账号和密码");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSubmit(values);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "保存用户失败，请稍后重试",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen onOpenChange={(open) => !open && !saving && onClose()}>
      <Modal.Backdrop
        isDismissable={!saving}
        isKeyboardDismissDisabled={saving}
      >
        <Modal.Container placement="center" size="lg" scroll="inside">
          <Modal.Dialog style={{ width: 750, maxWidth: "100%" }}>
            <Modal.Header>
              <Modal.Heading>{editing ? "编辑用户" : "添加用户"}</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭" isDisabled={saving} />
            </Modal.Header>
            <Modal.Body>
              <div inert={saving} style={{ display: "grid", gap: 16 }}>
                {editing ? (
                  <MySurface
                    style={{ display: "flex", alignItems: "center", gap: 16 }}
                  >
                    <UserAvatar user={editing} />
                    <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
                      <Typography className="text-lg" truncate>
                        {editing.displayName}
                      </Typography>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <SourceTag source={editing.sourceType} />
                        <DisplayTag
                          color={
                            editing.status === "active" ? "success" : "danger"
                          }
                        >
                          {editing.status === "active" ? "已启用" : "已停用"}
                        </DisplayTag>
                      </div>
                      <Description>
                        账号：{editing.username || "未设置"} ·{" "}
                        {editing.title || "未设置职位"}
                      </Description>
                    </div>
                  </MySurface>
                ) : null}
                {error ? (
                  <Alert>
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Description>{error}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}
                {!editing ? (
                  <Card className="p-0">
                    <Card.Header>
                      <Card.Title>平台账号</Card.Title>
                      <Description>
                        设置新用户登录平台所需的账号和密码。
                      </Description>
                    </Card.Header>
                    <Card.Content>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
                          gap: 12,
                        }}
                      >
                        <UserEditField
                          label="账号"
                          value={username}
                          onChange={setUsername}
                          isRequired
                        />
                        <UserEditField
                          label="密码"
                          type="password"
                          value={password}
                          onChange={setPassword}
                          isRequired
                        />
                      </div>
                    </Card.Content>
                  </Card>
                ) : null}
                <Card className="p-0">
                  <Card.Header>
                    <Card.Title>可维护资料</Card.Title>
                    <Description>
                      维护用户的姓名、联系方式与工作信息。
                    </Description>
                  </Card.Header>
                  <Card.Content>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <UserEditField
                          label="姓名"
                          value={editName}
                          onChange={setEditName}
                          isRequired
                        />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <UserEditField
                          label="职位"
                          value={editTitle}
                          onChange={setEditTitle}
                        />
                      </div>
                      <div style={{ gridColumn: "span 2", minWidth: 0 }}>
                        <RoleMultiSelect
                          label="角色"
                          options={roles.map((role) => ({
                            id: role.id,
                            label: role.name,
                            sourceType: role.sourceType,
                            searchText: `${role.name} ${role.sourceType}`,
                          }))}
                          value={editRoleIds}
                          onChange={setEditRoleIds}
                        />
                      </div>
                      <UserEditField
                        label="手机号"
                        value={editMobile}
                        onChange={setEditMobile}
                        type="tel"
                      />
                      <UserEditField
                        label="分机号"
                        value={editTelephone}
                        onChange={setEditTelephone}
                        type="tel"
                      />
                      <UserEditField
                        label="工号"
                        value={editJobNumber}
                        onChange={setEditJobNumber}
                      />
                      <UserEditField
                        label="办公地点"
                        value={editWorkPlace}
                        onChange={setEditWorkPlace}
                      />
                      <div style={{ gridColumn: "span 2", minWidth: 0 }}>
                        <UserEditField
                          label="主邮箱"
                          value={editEmail}
                          onChange={setEditEmail}
                          type="email"
                          placeholder="name@example.com"
                        />
                      </div>
                      <div style={{ gridColumn: "span 2", minWidth: 0 }}>
                        <UserEditField
                          label="主邮箱 SMTP 授权码"
                          value={smtpPassword}
                          onChange={setSmtpPassword}
                          type="password"
                          placeholder="留空保留原授权"
                        />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <UserEditField
                          label="备注"
                          value={editRemark}
                          onChange={setEditRemark}
                          multiline
                        />
                      </div>
                    </div>
                  </Card.Content>
                </Card>
                <AdditionalEmailFields
                  value={editEmailAddresses}
                  onChange={setEditEmailAddresses}
                />
                {editing ? (
                  <Card className="p-0">
                    <Card.Header>
                      <Card.Title>身份源资料</Card.Title>
                      <Description>
                        以下资料仅供查看，由身份源同步维护。
                      </Description>
                    </Card.Header>
                    <Card.Content>
                      <MySurface
                        className="p-2 grid gap-2"
                        style={{
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
                        }}
                      >
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
                      </MySurface>
                    </Card.Content>
                  </Card>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button isDisabled={saving} onPress={onClose}>
                取消
              </Button>
              <Button
                isDisabled={
                  saving ||
                  !editName.trim() ||
                  (!editing && (!username.trim() || !password.trim()))
                }
                onPress={() => void save()}
              >
                {saving ? "保存中…" : editing ? "保存" : "创建用户"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function UserEditField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  isRequired = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "tel" | "password";
  isRequired?: boolean;
  multiline?: boolean;
}) {
  return (
    <TextField
      value={value}
      onChange={onChange}
      isRequired={isRequired}
      fullWidth
      style={{ minWidth: 0 }}
    >
      <Label className="text-sm">{label}</Label>
      <InputGroup fullWidth>
        {multiline ? (
          <InputGroup.TextArea placeholder={placeholder || label} rows={3} />
        ) : (
          <InputGroup.Input type={type} placeholder={placeholder || label} />
        )}
      </InputGroup>
    </TextField>
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
    <div style={{ minWidth: 0 }}>
      <Description className="text-xs">{label}</Description>
      <Typography className="text-sm" style={{ overflowWrap: "anywhere" }}>
        {value || "—"}
      </Typography>
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
