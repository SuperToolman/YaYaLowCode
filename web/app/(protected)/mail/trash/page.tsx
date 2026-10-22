import { MailFolderView } from "../components/MailFolderView";

export default function MailPage() {
  return <MailFolderView folder="trash" label="已删除" emptyText="暂无已删除邮件" />;
}
