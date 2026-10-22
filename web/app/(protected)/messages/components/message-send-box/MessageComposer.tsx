"use client";
import { notifyRequestError } from "@lib/notify";
import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { notify } from "@lib/notify";
import { MySurface } from "@shared/ui/MySurface";
import type { JSONContent } from "@tiptap/react";
import type { CommunicationConversationResponse } from "@features/communication/api";
import { getCommunicationSettings } from "@features/settings/api";
import { uploadCommunicationFile } from "@features/communication/api";
import { MentionComposer, type MentionComposerHandle } from "./MentionComposer";
import { MessageSendToolbar } from "./MessageSendToolbar";
import { DraftSession, submitBatch } from "./draft-session";
import { emptyDraft, parseDraft, remainingDraft, validateFileSize, type DraftAsset } from "./draft";
type Props = {
  conversationId: string | null; value: string; members: CommunicationConversationResponse["members"]; disabled: boolean; busy: boolean; online: boolean; isReediting: boolean; reeditId?: string; existingAttachments?: DraftAsset[];
  onChange: (value: string) => void;
  onSendItem: (conversationId: string, type: string, content: string, fileIds: string[]) => Promise<boolean>;
  onOpenEmail: () => void; onCancelReedit: () => void;
};
type Draft = DraftSession;
export function MessageComposer(props: Props) {
  const [drafts] = useState(() => new Map<string, Draft>());
  useEffect(() => () => { for (const draft of drafts.values()) draft.dispose(); }, [drafts]);
  const key = `${props.conversationId ?? "none"}:${props.reeditId ?? "draft"}`;
  return <ComposerSession key={key} {...props} draftKey={key} drafts={drafts} />;
}
function ComposerSession({ drafts, draftKey, ...props }: Props & { drafts: Map<string, Draft>; draftKey: string }) {
  const [doc, setDoc] = useState<JSONContent>(() => {
    const cached = drafts.get(draftKey); if (cached) return cached.doc;
    const assets = new Map((props.existingAttachments ?? []).map(asset => [asset.id, asset]));
    const doc = props.isReediting ? remainingDraft([...(props.value ? [{ kind: "text" as const, content: props.value }] : []), ...Array.from(assets.keys()).map(assetId => ({ kind: "file" as const, assetId }))]) : emptyDraft();
    const created = new DraftSession(doc, assets); drafts.set(draftKey, created); return created.doc;
  });
  const draft = drafts.get(draftKey)!;
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);
  const locked = useRef(false);
  const composerEditor = useRef<MentionComposerHandle>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const changed = () => { setDoc(draft.doc); setSending(Boolean(draft.sending)); };
    return draft.subscribe(changed);
  }, [draft]);
  const disabled = props.disabled || props.busy || sending || Boolean(draft.sending);
  function update(next: JSONContent) {
    draft.setDocument(next);
    props.onChange(parseDraft(next).filter(item => item.kind === "text").map(item => item.content).join("\n"));
  }
  function addFiles(files: File[]) {
    return files.map(file => {
      const id = globalThis.crypto?.randomUUID?.() ?? `asset-${Date.now()}-${Math.random()}`;
      const asset: DraftAsset = { id, file, name: file.name || "粘贴图片.png", size: file.size, mimeType: file.type };
      draft.assets.set(id, asset);
      if (file.type.startsWith("image/")) {
        asset.url = URL.createObjectURL(file);
      }
      return id;
    });
  }
  async function sendDraft() {
    if (locked.current || draft.sending || disabled || !props.conversationId) return;
    const items = parseDraft(draft.doc); if (!items.length) return;
    if (items.some(item => item.kind === "file") && !props.online) { notify.warning("当前离线，请连接后发送附件"); return; }
    if (!draft.begin()) return; locked.current = true;
    const conversationId = props.conversationId;
    let accepted = 0;
    // The page already reports enqueue/reedit failures through the global notifier.
    const reportedFailure = new Error("消息发送失败");
    try {
      if (items.some(item => item.kind === "file")) {
        const settings = await getCommunicationSettings();
        for (const item of items) if (item.kind === "file") {
          const asset = draft.assets.get(item.assetId);
          if (asset) validateFileSize(asset.name, asset.size, (settings.maxFileUploadMb ?? 20));
        }
      }
      if (props.isReediting) {
        const fileIds: string[] = [];
        for (const item of items) if (item.kind === "file") fileIds.push(await uploadAsset(item.assetId));
        const content = items.filter(item => item.kind === "text").map(item => item.content).join("\n");
        if (!await props.onSendItem(conversationId, "text", content, fileIds)) throw reportedFailure;
        accepted = items.length;
      } else {
        const outcome = await submitBatch(items, async item => {
          const asset = item.kind === "file" ? draft.assets.get(item.assetId) : undefined;
          const fileIds = item.kind === "file" ? [await uploadAsset(item.assetId)] : [];
          if (!await props.onSendItem(conversationId, item.kind, item.kind === "text" ? item.content : asset?.name ?? "附件", fileIds)) throw reportedFailure;
        });
        accepted = items.length - outcome.remaining.length;
        if (outcome.error) throw outcome.error;
      }
    } catch (cause) { if (cause !== reportedFailure) notifyRequestError(cause, "消息发送失败", { description: cause instanceof Error ? cause.message : "发送失败，请重试" }); }
    finally {
      const remaining = items.slice(accepted);
      draft.finish(remaining);
      if (mounted.current) props.onChange(remaining.filter(item => item.kind === "text").map(item => item.content).join("\n"));
      locked.current = false;
    }
  }
  async function uploadAsset(id: string) {
    const asset = draft.assets.get(id); if (!asset) throw new Error("附件已失效，请重新选择");
    if (!asset.fileId) { if (!asset.file) throw new Error("附件已失效"); asset.fileId = (await uploadCommunicationFile(asset.file)).fileId; }
    return asset.fileId;
  }
  return <footer className="shrink-0">
    {props.isReediting ? <div className="flex items-center justify-between py-2"><span>正在重新编辑撤回的消息</span><Button isDisabled={sending} onPress={props.onCancelReedit}>取消</Button></div> : null}
    <MySurface className="flex max-h-[350px] flex-col">
      <MentionComposer ref={composerEditor} value={doc} assets={draft.assets} members={props.members} disabled={disabled} onChange={update} onFiles={addFiles} onSend={() => void sendDraft()} />
      <MessageSendToolbar disabled={disabled} busy={sending} hasContent={parseDraft(doc).length > 0} onInsertEmoji={emoji => composerEditor.current?.insertText(emoji)} onFilesSelect={files => composerEditor.current?.insertFiles(files)} onOpenEmail={props.onOpenEmail} onSend={() => void sendDraft()} />
    </MySurface>
  </footer>;
}
