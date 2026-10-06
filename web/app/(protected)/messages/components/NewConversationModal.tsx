import { useEffect, useState } from "react";
import { notify } from "@lib/notify";
import { Button, Checkbox, Input, Modal, Tabs } from "@heroui/react";
import { createDirectConversation, createGroupConversation, listCommunicationUsers, type CommunicationConversationResponse, type CommunicationUserResponse } from "@features/communication/api";

export function NewConversationModal({ open, onClose, onCreated, messageOf }: { open: boolean; onClose: () => void; onCreated: (id: string) => void; messageOf: (value: unknown) => string }) {
  const [users, setUsers] = useState<CommunicationUserResponse[]>([]);
  const [mode, setMode] = useState("direct");
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (open) void listCommunicationUsers().then((result) => { const payload = result.data as { data?: CommunicationUserResponse[] | null } | undefined; setUsers(payload?.data ?? []); }); }, [open]);
  const filtered = users.filter((item) => !query.trim() || item.displayName.toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN")));
  async function create() { setCreating(true); try { const generatedTitle = users.filter((item) => selected.includes(item.id)).map((item) => item.displayName).join("、").slice(0, 160); const result = mode === "direct" ? await createDirectConversation({ body: { userId: selected[0] } }) : await createGroupConversation({ body: { title: title.trim() || generatedTitle || "新建群聊", memberIds: selected } }); const payload = result.data as { data?: CommunicationConversationResponse | null; message?: string } | undefined; if (!payload?.data) throw new Error(payload?.message ?? "创建失败"); onCreated(payload.data.id); setSelected([]); setTitle(""); notify.success("会话已创建"); } catch (cause) { notify.error("创建会话失败", { description: messageOf(cause) }); } finally { setCreating(false); } }
  return <Modal isOpen={open} onOpenChange={(value) => !creating && !value && onClose()}><Modal.Backdrop className="theme-modal-backdrop" isDismissable={!creating}><Modal.Container placement="center" size="md"><Modal.Dialog><Modal.Header><Modal.Heading>新建会话</Modal.Heading><Modal.CloseTrigger aria-label="关闭" isDisabled={creating} /></Modal.Header><Modal.Body>
    <Tabs selectedKey={mode} onSelectionChange={(key) => { setMode(String(key)); setSelected([]); }}><Tabs.List aria-label="会话类型"><Tabs.Tab id="direct">单聊<Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="group">群聊<Tabs.Indicator /></Tabs.Tab></Tabs.List></Tabs>
    {mode === "group" ? <Input className="mt-3" fullWidth placeholder="群聊名称（可选）" value={title} disabled={creating} onChange={(event) => setTitle(event.currentTarget.value)} /> : null}
    <Input className="mt-3" aria-label="搜索用户" fullWidth placeholder="输入用户名称" value={query} disabled={creating} onChange={(event) => setQuery(event.currentTarget.value)} />
    <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">{filtered.map((item) => <Checkbox key={item.id} isSelected={selected.includes(item.id)} isDisabled={creating} onChange={(checked) => setSelected((current) => mode === "direct" ? checked ? [item.id] : [] : checked ? [...current, item.id] : current.filter((id) => id !== item.id))} className="w-full rounded-md px-2 py-2 hover:bg-[var(--color-control-soft-hover)]"><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{item.displayName}</Checkbox.Content></Checkbox>)}{filtered.length === 0 ? <p className="px-2 py-6 text-center text-sm text-[var(--color-text-secondary)]">未找到匹配的用户</p> : null}</div>
  </Modal.Body><Modal.Footer><Button isDisabled={creating} onPress={onClose}>取消</Button><Button isDisabled={creating || selected.length === 0} onPress={() => void create()}>{creating ? "正在创建…" : "创建"}</Button></Modal.Footer></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}
