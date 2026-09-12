"use client";
import { CircleInfo } from "@gravity-ui/icons";
import { Tooltip } from "@heroui/react";
export default function InfoTooltip({ content }: { content: React.ReactNode }) { return <Tooltip delay={0}><Tooltip.Trigger aria-label="更多信息"><CircleInfo className="size-4" /></Tooltip.Trigger><Tooltip.Content>{content}</Tooltip.Content></Tooltip>; }
