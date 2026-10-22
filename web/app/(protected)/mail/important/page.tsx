import { MailFolderView } from "../components/MailFolderView";

export default function MailPage() {
  return <MailFolderView folder="important" label="重要联系人" emptyText="暂无重要联系人邮件" />;
}
