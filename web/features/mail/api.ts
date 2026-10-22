import { sendMail as sendMailCommand, listMailMessages as listCommand, getMailMessage as detailCommand, downloadMailAttachment as downloadCommand, type MailPageResponse, type MailDetailResponse, type SendMailRequest } from "@/app/lib/http";
import { ApiRequestError, unwrapApiResult } from "@/app/lib/api-request";
import { getMailComposeContext as composeContextCommand, getRecentMailContacts as recentContactsCommand } from "@/app/lib/http";
export type { MailContact, MailComposeContext } from "@/app/lib/http";

export async function getRecentMailContacts() {
  const result = await recentContactsCommand({ responseStyle: "fields" });
  return unwrapApiResult(result);
}

export async function getMailComposeContext() {
  const result = await composeContextCommand({ responseStyle: "fields" });
  return unwrapApiResult(result);
}

export async function sendMail(payload: SendMailRequest) {
  const result = await sendMailCommand({ body: payload, responseStyle: "fields" });
  const data = unwrapApiResult(result);
  if (!data.accepted) throw new ApiRequestError("邮件发送失败", result.response?.status ?? 0, "business");
  return data;
}

export type { MailPageResponse, MailDetailResponse };
export type MailMessageIdentity = { uid: number; folder: string; uidValidity: number };
export async function downloadMailAttachment(message: MailMessageIdentity, attachmentId: number): Promise<Blob> {
  const { uid, ...query } = message;
  const result = await downloadCommand({ path: { uid, attachmentId }, query, parseAs: "blob", responseStyle: "fields" });
  const data: unknown = result.data;
  if (result.error || !(data instanceof Blob)) {
    const error = result.error as { message?: string } | undefined;
    throw new ApiRequestError(error?.message || "附件下载失败", result.response?.status ?? 0);
  }
  return data;
}
export async function listMailMessages(query: { folder: string; beforeUid?: number; uidValidity?: number }) {
  const result = await listCommand({ query, responseStyle: "fields" });
  return unwrapApiResult(result);
}
export async function getMailMessage(uid: number, query: { folder: string; uidValidity: number }) {
  const result = await detailCommand({ path: { uid }, query, responseStyle: "fields" });
  return unwrapApiResult(result);
}
