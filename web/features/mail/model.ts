export type MailListItem = {
  id: string;
  sender: string;
  recipient: string;
  subject: string;
  preview?: string;
  sentAt: string;
  isRead: boolean;
  isStarred: boolean;
};

export const mailFolders = [
  { id: "inbox", label: "收件箱", emptyText: "暂无邮件" },
  { id: "important", label: "重要联系人", emptyText: "暂无重要联系人邮件" },
  { id: "starred", label: "星标邮件", emptyText: "暂无星标邮件" },
  { id: "sent", label: "已发送", emptyText: "暂无已发送邮件" },
  { id: "drafts", label: "草稿箱", emptyText: "暂无草稿" },
  { id: "trash", label: "已删除", emptyText: "暂无已删除邮件" },
] as const;
