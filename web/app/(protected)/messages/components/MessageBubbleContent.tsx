import { Envelope } from "@gravity-ui/icons";
import { MyAvatar } from "@/shared/ui/MyAvatar";
import { isAttachmentOnlyMessage } from "./file-presentation";
import { MessageFile } from "./MessageFile";
import { MessageImage } from "./MessageImage";
import type { BubbleMessage } from "./message-bubble-types";

export function MessageBubbleContent({ message }: { message: BubbleMessage }) {
  if (message.status === "recalled") return <p>消息已撤回</p>;
  return (
    <>
      {message.messageType === "email" ? (
        <p>
          <Envelope />
          {message.emailSubject}
        </p>
      ) : null}
      {!isAttachmentOnlyMessage(message) && message.content ? <p className="whitespace-pre-wrap break-words">{message.content}</p> : null}
      <MessageAttachments message={message} />
    </>
  );
}

export function MessageAttachments({ message }: { message: BubbleMessage }) {
  if (message.status === "recalled") return null;
  return <>{message.attachments.map(attachment => attachment.isImage || attachment.mimeType.startsWith("image/") ?
    <MessageImage key={attachment.fileId} imageId={`${message.id}:${attachment.fileId}`} src={`/api/files/${attachment.fileId}/download`} alt={attachment.name} /> :
    <MessageFile key={attachment.fileId} attachment={attachment} />
  )}</>;
}

export function MessageAvatar({
  name,
  imageUrl,
  className,
}: {
  name: string;
  imageUrl?: string | null;
  className?: string;
}) {
  return (
    <MyAvatar
      name={name}
      imageUrl={imageUrl}
      className={className}
      style={{ borderRadius: "50%", boxShadow: "var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1))" }}
    />
  );
}
