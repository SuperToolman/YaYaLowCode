"use client";

import { Drawer } from "@heroui/react";
import { Clock } from "@gravity-ui/icons";
import type { MailDetailResponse, MailMessageIdentity } from "@features/mail/api";
import { MailBody } from "./MailBody";
import { MailAttachments } from "./MailAttachments";

type Props = {
  open: boolean;
  loading: boolean;
  detail: MailDetailResponse | null;
  message: MailMessageIdentity | null;
  onOpenChange: (open: boolean) => void;
};

function senderIdentity(value: string) {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>/);
  const address = match?.[2] || value;
  return {
    address,
    name:
      match?.[1]?.replace(/^"|"$/g, "") ||
      address.split("@")[0] ||
      "未知发件人",
  };
}

function MailMetadata({ detail }: { detail: MailDetailResponse }) {
  const sender = senderIdentity(detail.sender);
  const date = new Date(detail.sentAt);
  const time = Number.isNaN(date.getTime())
    ? detail.sentAt
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
        hour12: false,
      }).format(date);
  return (
    <div className="shrink-0 text-xs">
      <div className="flex items-start gap-2">
        <div
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-soft)] text-sm font-semibold text-[var(--color-primary)]"
        >
          {Array.from(sender.name)[0]?.toUpperCase()}
        </div>
        <dl className="m-0 grid min-w-0 flex-1 grid-cols-[2.5rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1 leading-5">
          <dt className="text-[var(--color-text-secondary)]">发件人</dt>
          <dd className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="font-semibold text-[var(--color-text-primary)]">
              {sender.name}
            </span>
            <span className="break-all text-[var(--color-text-secondary)]">
              {sender.address}
            </span>
          </dd>
          <dt className="text-[var(--color-text-secondary)]">收件人</dt>
          <dd className="m-0 break-words text-[var(--color-text-primary)]">
            {detail.recipient || "未提供"}
          </dd>
          {detail.cc ? (
            <>
              <dt className="text-[var(--color-text-secondary)]">抄送</dt>
              <dd className="m-0 break-words text-[var(--color-text-primary)]">
                {detail.cc}
              </dd>
            </>
          ) : null}
        </dl>
        <div className="flex max-w-[30%] shrink-0 items-start gap-1 pt-0.5 text-[11px] text-[var(--color-text-secondary)]">
          <Clock className="mt-0.5 size-3 shrink-0" />
          <time
            aria-label="时间"
            dateTime={
              Number.isNaN(date.getTime()) ? undefined : date.toISOString()
            }
            title={detail.sentAt}
          >
            {time || "未提供"}
          </time>
        </div>
      </div>
    </div>
  );
}

export function MailDetailDrawer({
  open,
  loading,
  detail,
  message,
  onOpenChange,
}: Props) {
  return (
    <Drawer isOpen={open} onOpenChange={onOpenChange}>
      <Drawer.Backdrop isDismissable>
        <Drawer.Content placement="right">
          <Drawer.Dialog
            className="min-h-0 overflow-hidden p-3"
            style={{ width: "50vw", maxWidth: "50vw" }}
          >
            <Drawer.Header className="shrink-0 gap-0 pb-2 pr-8">
              <Drawer.Heading className="break-words text-base leading-snug">
                {detail?.subject || (loading ? "正在打开邮件…" : "（无主题）")}
              </Drawer.Heading>
              <Drawer.CloseTrigger aria-label="关闭邮件详情" />
            </Drawer.Header>
            <Drawer.Body className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
              {loading ? (
                <div
                  role="status"
                  className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-secondary)]"
                >
                  正在读取邮件详情…
                </div>
              ) : detail ? (
                <>
                  <div className="max-h-[35%] shrink-0 overflow-auto overscroll-contain">
                    <MailMetadata detail={detail} />
                  </div>
                  {message ? <MailAttachments key={`${message.folder}:${message.uidValidity}:${message.uid}`} attachments={detail.attachments} message={message} /> : null}
                  <MailBody
                    html={detail.html}
                    text={detail.text}
                    inlineImages={detail.inlineImages}
                  />
                </>
              ) : null}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
