"use client";
import InfoTooltip from "@/shared/ui/InfoTooltip";
import { retrievalMode, retrievalReason } from "./retrieval-status";
export function KnowledgeRetrievalMode({ mode, limitations }: { mode: string; limitations?: string[] }) {
  return <div className="flex items-center gap-1 text-xs text-muted"><span>{retrievalMode(mode)}</span>{limitations?.length ? <InfoTooltip content={limitations.map(retrievalReason).join("；")} /> : null}</div>;
}
