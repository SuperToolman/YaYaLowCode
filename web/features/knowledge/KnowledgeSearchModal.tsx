"use client";
import { KnowledgeRetrievalMode } from "./KnowledgeRetrievalMode";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import { MySurface } from "@/shared/ui/MySurface";
import { searchKnowledge, type KnowledgeBase } from "./client";
import { parsingLocation } from "./parsing-status";
import { notifyRequestError } from "@/shared/lib/notify";

export function KnowledgeSearchModal({ base, onClose }: { base: KnowledgeBase; onClose: () => void }) {
  const [text, setText] = useState("");
  const query = useMutation({ mutationFn: (query: string) => searchKnowledge(base.id, query), onError: (error) => notifyRequestError(error, "检索知识失败") });
  return <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }}><Modal.Backdrop><Modal.Container size="lg"><Modal.Dialog>
    <Modal.Header><Modal.Heading>{base.name} · 试搜</Modal.Heading><Modal.CloseTrigger /></Modal.Header>
    <Modal.Body className="flex max-h-[60vh] min-w-0 flex-col gap-3 overflow-y-auto">
      <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (text.trim()) query.mutate(text.trim()); }}>
        <TextField value={text} onChange={setText} className="min-w-0 flex-1"><Label>关键词</Label><Input maxLength={200} autoFocus /></TextField>
        <Button type="submit" variant="secondary" isPending={query.isPending} isDisabled={!text.trim()}>搜索</Button>
      </form>
      {query.data && !query.error && <KnowledgeRetrievalMode mode={query.data.rankingMode} limitations={query.data.limitations} />}
      {!query.error && query.data?.items.map((item) => <MySurface key={item.chunkId} className="flex flex-col gap-2">
        <span className="text-sm font-medium">{item.documentName}</span>
        {item.sources?.length > 1 && <span className="text-xs text-muted">相同内容来自 {item.sources.length} 处：{item.sources.map((source) => source.documentName).join("、")}</span>}
        <span className="text-xs text-muted">版本 {item.documentVersion} · {parsingLocation(item.location as Record<string, unknown>)}</span>
        <pre className="whitespace-pre-wrap break-words text-sm">{item.text}</pre>
      </MySurface>)}
      {query.data && !query.data.items.length && <p className="text-sm text-muted">没有找到匹配资料；请确认文档已解析，或调整关键词。</p>}
    </Modal.Body>
  </Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}
