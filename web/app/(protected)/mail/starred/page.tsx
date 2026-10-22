import { MailFolderView } from "../components/MailFolderView";

export default function MailPage() {
  return <MailFolderView folder="starred" label="星标邮件" emptyText="暂无星标邮件" />;
}
