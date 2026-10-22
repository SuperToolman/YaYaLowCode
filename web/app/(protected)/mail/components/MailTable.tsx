"use client";

import { useState } from "react";
import { Avatar, Checkbox, Spinner, Table } from "@heroui/react";
import { FolderOpen } from "@gravity-ui/icons";
import { formatMailDate } from "@features/mail/format-date";
import { groupMailByDate } from "@features/mail/date-groups";
import type { MailListItem } from "@features/mail/model";

function MailParty({ value }: { value: string }) {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>/);
  const address = match?.[2] || value;
  const name = match?.[1]?.replace(/^"|"$/g, "") || address.split("@")[0] || "未知联系人";
  return <div className="flex w-full min-w-0 items-center gap-2">
    <Avatar size="sm" aria-label={`${name}的头像`} className="size-8 shrink-0 bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
      <Avatar.Fallback className="bg-[var(--color-primary-soft)] text-xs font-semibold text-[var(--color-primary)]">{Array.from(name)[0]?.toUpperCase()}</Avatar.Fallback>
    </Avatar>
    <div className="flex min-w-0 flex-1 flex-col gap-1"><span className="truncate">{name}</span><span className="truncate text-[var(--color-text-secondary)]" title={value}>{address}</span></div>
  </div>;
}
type Props = { items: MailListItem[]; label: string; emptyText: string; sent?: boolean; onOpen?: (id: string) => void; loading?: boolean; loadingMore?: boolean; hasMore?: boolean; onLoadMore?: () => void };

export function MailTable(props: Props) {
  if (!props.items.length) return <MailGroupTable {...props} />;
  const groups = groupMailByDate(props.items);
  return <div className="flex min-w-[620px] flex-col gap-3">
    {groups.map((group, index) => <section key={group.label} aria-label={`${group.label}邮件`}>
      <h3 className="flex items-center gap-2 px-2 py-2 text-xs font-semibold text-[var(--color-text-primary)]">{group.label}<span className="rounded bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--color-text-secondary)]">{group.items.length}</span></h3>
      <MailGroupTable {...props} items={group.items} label={`${props.label} · ${group.label}`} loading={index === groups.length - 1 && props.loading} loadingMore={index === groups.length - 1 && props.loadingMore} hasMore={index === groups.length - 1 && props.hasMore} />
    </section>)}
  </div>;
}

function MailSelectionCheckbox({ label }: { label: string }) {
  return <Checkbox slot="selection" aria-label={label}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox>;
}

function MailGroupTable({ items, label, emptyText, sent, onOpen, loading, loadingMore, hasMore, onLoadMore }: Props) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  return <Table className="w-full min-w-[620px] [&_td]:text-[12px] [&_th]:text-[12px]">
    <Table.Content aria-label={`${label}邮件列表`} className="min-w-[620px] table-fixed" selectionMode="multiple" selectionBehavior="toggle" selectedKeys={selectedKeys} onSelectionChange={keys => setSelectedKeys(keys === "all" ? new Set(items.map(item => item.id)) : new Set([...keys].map(String)))} onRowAction={(id) => onOpen?.(String(id))}>
      <Table.Header>
        <Table.Column id="select" style={{ width: 48 }}><MailSelectionCheckbox label="选择全部邮件" /></Table.Column>
        <Table.Column id="party" style={{ width: 240 }} isRowHeader>发件人/收件人</Table.Column>
        <Table.Column id="content">内容</Table.Column>
        <Table.Column id="time" style={{ width: 180 }}>时间</Table.Column>
      </Table.Header>
      <Table.Body renderEmptyState={() => loading ? null : <div className="flex min-h-64 flex-col items-center justify-center gap-2 p-8 text-center"><FolderOpen className="h-8 w-8 text-[var(--color-text-disabled)]" /><p className="text-[12px] text-[var(--color-text-secondary)]">{emptyText}</p></div>}>
        <Table.Collection items={items}>
          {(item) => <Table.Row id={item.id} textValue={item.subject} className="cursor-pointer">
            <Table.Cell><MailSelectionCheckbox label={`选择 ${item.subject}`} /></Table.Cell>
            <Table.Cell><MailParty value={sent ? item.recipient : item.sender} /></Table.Cell>
            <Table.Cell><div className="flex min-w-0 flex-col gap-1"><span className={`line-clamp-1 ${item.isRead ? "" : "font-semibold"}`}>{item.subject || "（无主题）"}</span><span className="line-clamp-1 text-[var(--color-text-secondary)]">{item.preview || "暂无正文摘要"}</span></div></Table.Cell>
            <Table.Cell><span className="whitespace-nowrap" title={item.sentAt}>{formatMailDate(item.sentAt)}</span></Table.Cell>
          </Table.Row>}
        </Table.Collection>
        {loading || loadingMore || hasMore ? <Table.LoadMore isLoading={loading || loadingMore} onLoadMore={hasMore && !loading && !loadingMore ? onLoadMore : undefined} scrollOffset={0.25}>
          <Table.LoadMoreContent><Spinner size="sm" /><span role="status">{loading ? items.length ? "正在更新邮件…" : "正在读取邮件…" : "正在加载更多邮件…"}</span></Table.LoadMoreContent>
        </Table.LoadMore> : null}
      </Table.Body>
    </Table.Content>
  </Table>;
}
