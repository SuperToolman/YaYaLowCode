import { MailFolderView } from "../components/MailFolderView";

export default function MailPage() {
  return <MailFolderView folder="drafts" label="草稿箱" emptyText="暂无草稿" />;
}
