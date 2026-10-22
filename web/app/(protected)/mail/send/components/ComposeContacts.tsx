"use client";

import { Avatar, Button, Card, Input, Label, ListBox, ScrollShadow, Spinner } from "@heroui/react";
import { useState } from "react";
import type { MailContact } from "@features/mail/api";

export function ComposeContacts({ contacts, loading, failed, disabled, onRetry, onSelect }: { contacts: MailContact[]; loading: boolean; failed: boolean; disabled: boolean; onRetry: () => void; onSelect: (email: string) => void }) {
  const [query, setQuery] = useState("");
  const filtered = contacts.filter(contact => `${contact.name} ${contact.email}`.toLowerCase().includes(query.toLowerCase()));
  return <Card aria-label="最近联系人" className="min-h-0 gap-3 overflow-hidden max-lg:hidden">
    <Input aria-label="搜索联系人" placeholder="搜索姓名或邮箱" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="flex items-center justify-between text-sm"><span>最近联系人</span><span className="text-xs text-muted">{contacts.length}</span></div>
    {loading ? <Spinner aria-label="加载联系人" /> : failed ? <Button onPress={onRetry}>重试加载联系人</Button> : <ScrollShadow className="min-h-0 flex-1 overflow-auto"><ListBox aria-label="选择联系人" selectionMode="none" disabledKeys={disabled ? filtered.map(contact => contact.email) : []} onAction={key => onSelect(String(key))} items={filtered} renderEmptyState={() => "最近一周暂无匹配的往来联系人，可直接输入邮箱"}>
      {contact => <ListBox.Item id={contact.email} textValue={`${contact.name} ${contact.email}`}><Avatar size="sm"><Avatar.Image src={contact.avatarUrl ?? undefined} /><Avatar.Fallback>{contact.name.slice(0, 1)}</Avatar.Fallback></Avatar><div className="min-w-0"><Label>{contact.name}</Label><div className="truncate text-xs text-muted">{contact.email}</div></div></ListBox.Item>}
    </ListBox></ScrollShadow>}
  </Card>;
}
