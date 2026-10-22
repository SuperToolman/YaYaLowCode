import { MailFolderView } from "./components/MailFolderView";

export default function MailPage() {
  return <MailFolderView folder="inbox" label="收件箱" emptyText="暂无邮件" />;
}
