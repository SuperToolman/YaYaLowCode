"use client";

import { type ReactNode } from "react";
import { Button,Card } from "@heroui/react";
import { Envelope, EnvelopeOpen, Folder, Person, Star, TrashBin } from "@gravity-ui/icons";
import { PageContentLayout } from "@/app/components/PageContentLayout";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const folders = [
  { id: "inbox", label: "收件箱", icon: Envelope },
  { id: "important", label: "重要联系人", icon: Person },
  { id: "starred", label: "星标邮件", icon: Star },
  { id: "sent", label: "已发送", icon: EnvelopeOpen },
  { id: "drafts", label: "草稿箱", icon: Folder },
  { id: "trash", label: "已删除", icon: TrashBin },
] as const;

export default function MailLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const composing = pathname === "/mail/send";

  return <PageContentLayout className="flex-1 overflow-hidden" title={composing ? "写邮件" : "邮箱"} subtitle={composing ? "使用当前主邮箱发送邮件" : "主邮箱邮件工作台"} actions={composing ? undefined : <Button onPress={() => router.push("/mail/send")}><Envelope />写邮件</Button>}>
    {composing ? <div className="flex h-full min-h-0 flex-col">{children}</div> : <main className="grid h-full min-h-0 overflow-hidden grid-cols-[210px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-3 max-[780px]:grid-cols-1 max-[780px]:grid-rows-[auto_minmax(0,1fr)]">
      <Card className="min-h-0 overflow-y-auto overscroll-contain">
        <nav aria-label="邮件分类" className="flex flex-col gap-1">
          {folders.map((folder) => { const Icon = folder.icon; const href = folder.id === "inbox" ? "/mail" : `/mail/${folder.id}`; const active = pathname === href; return <Link key={folder.id} href={href} aria-current={active ? "page" : undefined} className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${active ? "bg-[var(--color-control-selected)] text-[var(--color-primary)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-control-soft-hover)] hover:text-[var(--color-text-primary)]"}`}><Icon className="h-4 w-4" /><span>{folder.label}</span></Link>; })}
        </nav>
      </Card>
      <Card className="min-h-0 min-w-0 overflow-hidden">
        {children}
      </Card>
    </main>}
  </PageContentLayout>;
}

