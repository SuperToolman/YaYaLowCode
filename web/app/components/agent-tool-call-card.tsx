"use client";

import { ArrowChevronDown, Check, Code, Copy } from "@gravity-ui/icons";
import { Accordion, Button, Surface, Tooltip } from "@heroui/react";
import { useState } from "react";
import type { AgentToolActivity } from "@/features/agent-assistant/types";

const json = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2);

export function ToolCallCard({ activity }: { activity: AgentToolActivity }) {
  return <Accordion className="mx-0 gap-0" defaultExpandedKeys={activity.status === "running" ? [activity.id] : []}><Accordion.Item id={activity.id} className="mx-0"><Accordion.Heading className="mx-0"><Accordion.Trigger className="mx-0 min-w-0 px-0"><Code className="size-4" /><span className="min-w-0 flex-1 truncate text-xs text-muted" title={activity.name}>Tool · {activity.name}</span><Accordion.Indicator className="shrink-0"><ArrowChevronDown /></Accordion.Indicator></Accordion.Trigger></Accordion.Heading><Accordion.Panel className="px-0"><Surface className="rounded-2xl"><div className="divide-y divide-default"><ToolValue label="参数" value={activity.arguments} /><>{activity.result !== undefined ? <ToolValue label="结果" value={activity.result} /> : null}</>{activity.error ? <p role="alert" className="p-3">{json(activity.error)}</p> : null}</div></Surface></Accordion.Panel></Accordion.Item></Accordion>;
}

function ToolValue({ label, value }: { label: string; value: unknown }) {
  const valueText = json(value);
  return <section className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-4 p-3"><h3 className="pt-1 text-xs text-muted">{label}</h3><div className="relative min-w-0"><CopyButton value={valueText} label={`复制${label}`} /><pre className="m-0 max-h-72 overflow-auto pr-8 text-xs">{valueText}</pre></div></section>;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() { await navigator.clipboard?.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
  return <Tooltip><Tooltip.Trigger className="absolute right-0 top-0"><Button isIconOnly size="sm" aria-label={copied ? "已复制" : label} onPress={() => void copy()}>{copied ? <Check /> : <Copy />}</Button></Tooltip.Trigger><Tooltip.Content>{copied ? "已复制" : label}</Tooltip.Content></Tooltip>;
}
