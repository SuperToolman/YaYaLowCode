"use client";

import { useState } from "react";
import { Avatar, ComboBox, InputGroup, Label, ListBox, Tag, TagGroup } from "@heroui/react";
import { notify } from "@lib/notify";
import type { MailContact } from "@features/mail/api";

export function splitRecipients(value: string) {
  return value.split(/[\s,;，；]+/).map(value => value.trim()).filter(Boolean);
}

export const MAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isMailAddress = (value: string) => value.length <= 320 && MAIL_ADDRESS_PATTERN.test(value);

export type RecipientValue = { addresses: string[]; input: string };
export const emptyRecipients = (): RecipientValue => ({ addresses: [], input: "" });
export const recipientAddresses = (value: RecipientValue) => [...value.addresses, ...splitRecipients(value.input)];

export function MailSelect({ label, value, onChange, contacts, disabled, onFocus }: {
  label: string; value: RecipientValue; onChange: (value: RecipientValue) => void;
  contacts: MailContact[]; disabled: boolean; onFocus: () => void;
}) {
  const [open, setOpen] = useState(false);
  const query = value.input.trim().toLowerCase();
  const options = contacts.filter(contact => !value.addresses.some(email => email.toLowerCase() === contact.email.toLowerCase()) && `${contact.name} ${contact.email}`.toLowerCase().includes(query));
  function commit(input: string) {
    if (disabled) return;
    const next = splitRecipients(input);
    if (next.some(email => !isMailAddress(email))) {
      notify.error(`${label}地址格式不正确`, { description: "请输入有效的邮箱地址，例如 name@example.com" });
      return;
    }
    const all = [...value.addresses, ...next].map(email => email.toLowerCase());
    if (new Set(all).size !== all.length) {
      notify.error("收件人地址不能重复");
      return;
    }
    if (next.length) onChange({ addresses: [...value.addresses, ...next], input: "" });
    setOpen(false);
  }
  return <div className="flex min-w-0 flex-col gap-1">
    <ComboBox allowsCustomValue defaultFilter={() => true} menuTrigger="focus" isDisabled={disabled} inputValue={value.input} selectedKey={null}
      onOpenChange={setOpen} onInputChange={input => { onChange({ ...value, input }); setOpen(true); }}
      onSelectionChange={key => { if (key) commit(String(key)); }}>
      <Label>{label}</Label>
      <ComboBox.InputGroup>
        <InputGroup className="min-w-0 flex-1 flex-wrap gap-1 py-1 pe-8">
    {value.addresses.length ? <TagGroup className="min-w-0 max-w-full ps-2" aria-label={`已选${label}`} disabledKeys={disabled ? value.addresses.map((_, index) => String(index)) : []} onRemove={keys => onChange({ ...value, addresses: value.addresses.filter((_, index) => !keys.has(String(index))) })}>
      <TagGroup.List className="flex flex-wrap gap-1">{value.addresses.map((email, index) => <Tag className="max-w-full" key={index} id={String(index)} textValue={email}><span className="truncate" title={email}>{contacts.find(item => item.email.toLowerCase() === email.toLowerCase())?.name || email}</span><Tag.RemoveButton aria-label={`移除 ${email}`} /></Tag>)}</TagGroup.List>
    </TagGroup> : null}

        <InputGroup.Input className="min-w-40 basis-40" placeholder="输入名称或邮箱，回车添加" onFocus={onFocus} onBlur={() => { if (value.input.trim() && !open) commit(value.input); }}
        onPaste={event => { const text = event.clipboardData.getData("text"); if (splitRecipients(text).length > 1) { event.preventDefault(); commit(text); } }}
        onKeyDown={event => { if (["Enter", ",", ";", "，", "；"].includes(event.key) && value.input.trim() && !event.nativeEvent.isComposing) { if (event.key === "Enter" && !isMailAddress(value.input.trim()) && event.currentTarget.getAttribute("aria-activedescendant")) return; event.preventDefault(); commit(value.input); } }} />
        </InputGroup>
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <ComboBox.Popover><ListBox aria-label={`${label}建议`} items={options} renderEmptyState={() => "可直接输入邮箱，回车添加"}>
        {contact => <ListBox.Item id={contact.email} textValue={contact.email}><Avatar size="sm"><Avatar.Image src={contact.avatarUrl ?? undefined} /><Avatar.Fallback>{contact.name.slice(0, 1)}</Avatar.Fallback></Avatar><div className="min-w-0"><Label>{contact.name}</Label><div className="truncate text-xs text-muted">{contact.email}</div></div><ListBox.ItemIndicator /></ListBox.Item>}
      </ListBox></ComboBox.Popover>
    </ComboBox>
  </div>;
}
