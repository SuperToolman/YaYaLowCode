import type { CommunicationMessageResponse } from "@features/communication/api";
export type ConversationImage = { id: string; src: string; alt: string };
export function messageImages(messages: CommunicationMessageResponse[]): ConversationImage[] {
  return [...messages].filter(message => message.status !== "recalled").sort((a, b) => a.sequence - b.sequence).flatMap(message => message.attachments.filter(file => file.isImage || file.mimeType.startsWith("image/")).map(file => ({ id: `${message.id}:${file.fileId}`, src: `/api/files/${file.fileId}/download`, alt: file.name })));
}

export function isImageOnlyMessage(message: CommunicationMessageResponse) {
  const files = message.attachments;
  return message.status !== "recalled" && message.messageType === "file" && files.length > 0
    && files.every(file => file.isImage || file.mimeType.startsWith("image/"))
    && (!message.content.trim() || files.some(file => file.name === message.content.trim()));
}
