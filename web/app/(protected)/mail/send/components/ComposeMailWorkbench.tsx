"use client";
import { notifyRequestError } from "@lib/notify";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Avatar,
  Button,
  ButtonGroup,
  Card,
  Input,
  Label,
  Modal,
  TextField,
} from "@heroui/react";
import { Envelope, Eye, Paperclip, Xmark } from "@gravity-ui/icons";
import { notify } from "@lib/notify";
import {
  getMailComposeContext,
  getRecentMailContacts,
  type MailContact,
  sendMail,
  type MailComposeContext,
} from "@features/mail/api";
import {
  MailSelect,
  isMailAddress,
  emptyRecipients,
  recipientAddresses,
  type RecipientValue,
} from "./MailSelect";
import { ComposeContacts } from "./ComposeContacts";
import {
  MailRichTextEditor,
  type MailBodyValue,
  type MailEditorHandle,
} from "./MailRichTextEditor";
import {
  ComposeAttachments,
  encodeAttachment,
  MAX_ATTACHMENT_BYTES,
  type ComposeAttachment,
} from "./ComposeAttachments";
import { MailBody } from "../../components/MailBody";

type Field = "to" | "cc" | "bcc";
const empty = () => ({
  to: emptyRecipients(),
  cc: emptyRecipients(),
  bcc: emptyRecipients(),
});

export function ComposeMailWorkbench({
  onCancel,
  onSent,
}: {
  onCancel: () => void;
  onSent: () => void;
}) {
  const [recipients, setRecipients] = useState(empty);
  const [visibleCc, setVisibleCc] = useState(false);
  const [visibleBcc, setVisibleBcc] = useState(false);
  const [activeField, setActiveField] = useState<Field>("to");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState<MailBodyValue>({ html: "", text: "" });
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [context, setContext] = useState<MailComposeContext | null>(null);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsFailed, setContactsFailed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [contacts, setContacts] = useState<MailContact[]>([]);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const editor = useRef<MailEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadGeneration = useRef(0);
  const loadContext = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setContactsLoading(true);
    setContactsFailed(false);
    try {
      const result = await getMailComposeContext();
      if (generation !== loadGeneration.current) return;
      setContext(result);
      const recent = await getRecentMailContacts();
      if (generation === loadGeneration.current) {
        setContacts(recent.filter(contact => contact.email.toLowerCase() !== result.sender.email.toLowerCase()));
      }
    } catch (cause) {
      if (generation === loadGeneration.current) {
        setContactsFailed(true);
        notifyRequestError(cause, "写信信息加载失败", {
          description: cause instanceof Error ? cause.message : "请重试",
        });
      }
    } finally {
      if (generation === loadGeneration.current) setContactsLoading(false);
    }
  }, []);
  useEffect(() => {
    // Load sender first so writing remains available while IMAP contacts load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadContext();
    const generation = loadGeneration;
    return () => {
      generation.current++;
    };
  }, [loadContext]);
  function update(field: Field, value: RecipientValue) {
    setRecipients((current) => ({ ...current, [field]: value }));
  }
  function addContact(email: string) {
    const current = recipients[activeField];
    if (
      recipientAddresses(current).some(
        (value) => value.toLowerCase() === email.toLowerCase(),
      )
    )
      return;
    update(activeField, {
      addresses: [...recipientAddresses(current), email],
      input: "",
    });
  }
  function addFiles(files: File[]) {
    const next = [
      ...attachments,
      ...files.map((file) => ({ id: crypto.randomUUID(), file })),
    ];
    if (next.length > 10) return notify.error("最多添加 10 个附件");
    if (
      next.reduce((size, item) => size + item.file.size, 0) >
      MAX_ATTACHMENT_BYTES
    )
      return notify.error("附件总大小最多 6MB");
    if (files.some((file) => new TextEncoder().encode(file.name).length > 255))
      return notify.error("附件文件名过长");
    setAttachments(next);
  }
  async function submit() {
    if (sendingRef.current) return;
    const addresses = {
      to: recipientAddresses(recipients.to),
      cc: recipientAddresses(recipients.cc),
      bcc: recipientAddresses(recipients.bcc),
    };
    if (!addresses.to.length) return notify.error("至少填写一个收件人");
    for (const [field, label] of [
      ["to", "收件人"],
      ["cc", "抄送"],
      ["bcc", "密送"],
    ] as const) {
      if (
        addresses[field].some(
          (value) =>
            !isMailAddress(value),
        )
      )
        return notify.error(`${label}地址格式不正确`);
    }
    const all = [...addresses.to, ...addresses.cc, ...addresses.bcc].map(
      (value) => value.toLowerCase(),
    );
    if (new Set(all).size !== all.length)
      return notify.error("收件人地址不能重复");
    if (all.length > 60) return notify.error("一封邮件最多填写 60 个收件地址");
    if (!subject.trim()) return notify.error("邮件主题不能为空");
    if (!body.text.trim() && !body.html.includes("<img"))
      return notify.error("邮件正文不能为空");
    const text =
      body.text.trim() || "（图片邮件，请使用支持 HTML 的客户端查看）";
    if (
      [...subject.trim()].length > 100 ||
      new TextEncoder().encode(text).length > 80 * 1024 ||
      new TextEncoder().encode(body.html).length > 512 * 1024
    )
      return notify.error(
        "主题最多 100 个字符，文本正文最多 80KB，富文本最多 512KB",
      );
    sendingRef.current = true;
    setSending(true);
    try {
      const result = await sendMail({
        ...addresses,
        subject: subject.trim(),
        text,
        html: body.html,
        attachments: await Promise.all(
          attachments.map((item) => encodeAttachment(item.file)),
        ),
      });
      notify.success("邮件已提交发送");
      if (result.archiveWarning) notify.warning(result.archiveWarning);
      setRecipients(empty());
      setSubject("");
      setBody({ html: "", text: "" });
      setAttachments([]);
      editor.current?.reset();
      onSent();
    } catch (cause) {
      notifyRequestError(cause, cause instanceof Error ? cause.message : "邮件发送失败");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  return (
    <form
      aria-label="写邮件"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_240px] gap-3 overflow-hidden max-lg:grid-cols-1"
    >
      <Card className="min-h-0 min-w-0 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-separator py-2">
            <ButtonGroup aria-label="邮件操作" isDisabled={sending}>
              <Button variant="primary" type="submit" isDisabled={sending} isPending={sending}>
                <Envelope />
                发送
              </Button>
              <Button variant="tertiary" isDisabled={sending} onPress={() => setPreview(true)}>
                <Eye />
                预览
              </Button>
              <Button
                variant="tertiary"
                isDisabled={sending}
                onPress={() => fileInput.current?.click()}
              >
                <Paperclip />
                附件
              </Button>
            </ButtonGroup>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              aria-label="添加附件"
              disabled={sending}
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <Button className="ml-auto" variant="tertiary" isIconOnly aria-label="取消" isDisabled={sending} onPress={onCancel}>
              <Xmark />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain">
            <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 py-2">
              <MailSelect
                label="收件人"
                value={recipients.to}
                onChange={(value) => update("to", value)}
                contacts={contacts}
                disabled={sending}
                onFocus={() => setActiveField("to")}
              />
              <div className="flex gap-1">
                <Button
                  size="sm"
                  isDisabled={sending}
                  onPress={() => setVisibleCc((current) => !current)}
                >
                  抄送
                  {recipients.cc.addresses.length
                    ? ` (${recipients.cc.addresses.length})`
                    : ""}
                </Button>
                <Button
                  size="sm"
                  isDisabled={sending}
                  onPress={() => setVisibleBcc((current) => !current)}
                >
                  密送
                  {recipients.bcc.addresses.length
                    ? ` (${recipients.bcc.addresses.length})`
                    : ""}
                </Button>
              </div>
            </div>
            {visibleCc ? (
              <div className="shrink-0 pb-2">
                <MailSelect
                  label="抄送"
                  value={recipients.cc}
                  onChange={(value) => update("cc", value)}
                  contacts={contacts}
                  disabled={sending}
                  onFocus={() => setActiveField("cc")}
                />
              </div>
            ) : null}
            {visibleBcc ? (
              <div className="shrink-0 pb-2">
                <MailSelect
                  label="密送"
                  value={recipients.bcc}
                  onChange={(value) => update("bcc", value)}
                  contacts={contacts}
                  disabled={sending}
                  onFocus={() => setActiveField("bcc")}
                />
              </div>
            ) : null}
            <TextField className="shrink-0 pb-2" isRequired isDisabled={sending}>
              <Label>主题</Label>
              <Input
                maxLength={100}
                placeholder="请输入邮件主题"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </TextField>
            <ComposeAttachments
              attachments={attachments}
              disabled={sending}
              onRemove={(id) =>
                setAttachments((current) =>
                  current.filter((item) => item.id !== id),
                )
              }
            />
            <MailRichTextEditor
              ref={editor}
              disabled={sending}
              onChange={setBody}
            />
          </div>
          <footer className="flex shrink-0 items-center gap-2 text-xs">
            <span className="text-muted">发件人</span>
            <Avatar size="sm">
              <Avatar.Image src={context?.sender.avatarUrl ?? undefined} />
              <Avatar.Fallback>
                {context?.sender.name.slice(0, 1) || "邮"}
              </Avatar.Fallback>
            </Avatar>
            <span>{context?.sender.name}</span>
            <span className="text-muted">
              {context?.sender.email ||
                (contactsLoading
                  ? "正在读取主邮箱…"
                  : "请在用户管理中配置主邮箱")}
            </span>
          </footer>
        </div>
      </Card>
      <ComposeContacts
        contacts={contacts}
        loading={contactsLoading}
        failed={contactsFailed}
        disabled={sending}
        onRetry={() => void loadContext()}
        onSelect={addContact}
      />
      <Modal isOpen={preview} onOpenChange={setPreview}>
        <Modal.Backdrop>
          <Modal.Container size="lg">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>{subject || "（无主题）"}</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <div className="text-sm">
                  收件人：
                  {recipientAddresses(recipients.to).join("，") || "未填写"}
                </div>
                {recipientAddresses(recipients.cc).length ? (
                  <div className="text-sm">
                    抄送：{recipientAddresses(recipients.cc).join("，")}
                  </div>
                ) : null}
                <div className="text-xs text-muted">
                  附件：
                  {attachments.map((item) => item.file.name).join("，") || "无"}
                </div>
                <MailBody html={body.html || null} text={body.text} />
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </form>
  );
}
