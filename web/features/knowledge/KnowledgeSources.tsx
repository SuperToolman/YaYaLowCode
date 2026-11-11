"use client";
import { KnowledgeRetrievalMode } from "./KnowledgeRetrievalMode";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Modal, Spinner } from "@heroui/react";
import { BookOpen } from "@gravity-ui/icons";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { MySurface } from "@/shared/ui/MySurface";
import { readCitation, downloadDocument } from "./client";
import { notifyRequestError } from "@/shared/lib/notify";
import { parsingLocation } from "./parsing-status";
import { evidenceSources } from "./evidence-sources";

export function KnowledgeCitationModal({ citationId, onClose }: { citationId: string; onClose: () => void }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["knowledge", user?.id, "citation", citationId],
    queryFn: ({ signal }) => readCitation(citationId, signal),
    staleTime: 0, gcTime: 0, retry: false,
    refetchOnMount: "always",
    refetchInterval: 5000,
  });
  const source = !query.error ? query.data : undefined;
  return <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }}><Modal.Backdrop><Modal.Container size="lg"><Modal.Dialog>
    <Modal.Header><Modal.Heading>{source?.documentName ?? "知识来源"}</Modal.Heading><Modal.CloseTrigger /></Modal.Header>
    <Modal.Body className="flex max-h-[60vh] min-w-0 flex-col gap-3 overflow-y-auto">
      {query.isPending ? <Spinner aria-label="加载知识来源" /> : source ? <>
        <span className="text-xs text-muted">文档版本 {source.documentVersion} · {parsingLocation(source.location as Record<string, unknown>)}</span>
        <MySurface><pre className="whitespace-pre-wrap break-words text-sm">{source.text}</pre></MySurface>
      </> : <p role="status">来源已失效、已删除或当前无访问权限。</p>}
    </Modal.Body>
    <Modal.Footer>{source && <Button variant="secondary" isPending={busy} onPress={() => {
      setBusy(true);
      void downloadDocument(source.versionId, source.documentName).catch((error) => notifyRequestError(error, "下载来源失败")).finally(() => setBusy(false));
    }}>下载原件</Button>}</Modal.Footer>
  </Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}

export function KnowledgeSources({ result }: { result: unknown }) {
  const [selected, setSelected] = useState<string>();
  const root = result && typeof result === "object" ? result as Record<string, unknown> : undefined;
  const data = root?.result && typeof root.result === "object" ? root.result as Record<string, unknown> : root;
  const items = Array.isArray(data?.items) ? data.items as Array<Record<string, unknown>> : [];
  const sources = evidenceSources(items).filter((item) => typeof item.documentName === "string");
  if (!sources.length && typeof data?.rankingMode !== "string") return null;
  return <div className="flex flex-wrap items-center gap-2">
    {typeof data?.rankingMode === "string" && <KnowledgeRetrievalMode mode={data.rankingMode} limitations={Array.isArray(data.limitations) ? data.limitations.filter((v): v is string => typeof v === "string") : undefined} />}
    {sources.map((source) => <Button key={String(source.citationId)} size="sm" variant="ghost" onPress={() => setSelected(String(source.citationId))}><BookOpen />{String(source.documentName)}</Button>)}
    {selected && <KnowledgeCitationModal key={selected} citationId={selected} onClose={() => setSelected(undefined)} />}
  </div>;
}
