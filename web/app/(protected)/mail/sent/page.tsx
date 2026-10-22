import { MailFolderView } from "../components/MailFolderView";

export default function MailPage() {
  return <MailFolderView folder="sent" label="已发送" emptyText="暂无已发送邮件" />;
}
