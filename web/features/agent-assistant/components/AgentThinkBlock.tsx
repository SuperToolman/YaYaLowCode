"use client";

import { ArrowChevronDown, FaceRobot } from "@gravity-ui/icons";
import { Accordion } from "@heroui/react";

const firstLine = (value: string) => value.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "正在分析";

export function ThinkBlock({ text, index }: { text: string; index: number }) {
  return <Accordion className="mx-0 gap-0"><Accordion.Item id={`thought-${index}`} className="group mx-0"><Accordion.Heading className="mx-0"><Accordion.Trigger className="mx-0 min-w-0 px-0"><FaceRobot className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-xs text-muted group-data-[expanded=true]:hidden">Think · {firstLine(text)}</span><Accordion.Indicator className="shrink-0"><ArrowChevronDown /></Accordion.Indicator></Accordion.Trigger></Accordion.Heading><Accordion.Panel><p className="whitespace-pre-wrap text-sm text-muted">{text}</p></Accordion.Panel></Accordion.Item></Accordion>;
}
