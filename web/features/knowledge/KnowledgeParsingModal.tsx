"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Modal, Spinner } from "@heroui/react";
import { MySurface } from "@/shared/ui/MySurface";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { notifyRequestError } from "@/shared/lib/notify";
import { readParsing, reprocessDocument, type KnowledgeDocument } from "./client";
import { parsingErrors, parsingLocation, parsingStatus } from "./parsing-status";

type Props = {
  document: KnowledgeDocument;
  canRetry: boolean;
  onClose: () => void;
};

export function KnowledgeParsingModal({ document, canRetry, onClose }: Props) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const query = useQuery({
    queryKey: ["knowledge", user?.id, "parsing", document.versionId, offset],
    queryFn: ({ signal }) => readParsing(document.versionId, offset, signal),
    refetchInterval: (query) =>
      ["queued", "processing"].includes(query.state.data?.status ?? "")
        ? 3000
        : false,
  });
  useEffect(() => {
    if (query.error) notifyRequestError(query.error, "读取解析结果失败");
  }, [query.error]);
  const result = query.data;
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{document.name}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex max-h-[60vh] min-w-0 flex-col gap-3 overflow-y-auto">
              {query.isPending ? (
                <Spinner aria-label="加载解析结果" />
              ) : query.isError ? (
                <Button
                  variant="secondary"
                  onPress={() => void query.refetch()}
                >
                  重新加载
                </Button>
              ) : (
                result && (
                  <>
                    <p className="text-sm text-muted">
                      {parsingStatus[result.status] ?? "待解析"}
                      {result.chunkCount > 0
                        ? ` · ${result.chunkCount} 个分块`
                        : ""}
                    </p>
                    {result.errorCode && (
                      <p role="status" className="text-sm text-muted">
                        {parsingErrors[result.errorCode] ??
                          "解析未完成，请重试或检查服务。"}
                      </p>
                    )}
                    {result.status === "ready" && (
                      <p className="text-xs text-muted">
                        已提取文本与表格数据并接入检索；向量索引状态可在知识库中查看。不含
                        OCR、图片或版式还原。
                      </p>
                    )}
                    {result.chunks.map((chunk) => (
                      <MySurface
                        key={chunk.ordinal}
                        className="flex min-w-0 flex-col gap-2"
                      >
                        <span className="text-xs text-muted">
                          {parsingLocation(
                            chunk.location as Record<string, unknown>,
                          )}{" "}
                          · 分块 {chunk.ordinal + 1}
                        </span>
                        <pre className="whitespace-pre-wrap break-words text-sm">
                          {chunk.text}
                        </pre>
                      </MySurface>
                    ))}
                  </>
                )
              )}
            </Modal.Body>
            <Modal.Footer>
              {result?.status === "failed" && canRetry && (
                <Button
                  variant="secondary"
                  isPending={retrying}
                  onPress={() => {
                    if (retrying) return;
                    setRetrying(true);
                    void reprocessDocument(document.versionId)
                      .then(() =>
                        client.invalidateQueries({
                          queryKey: ["knowledge", user?.id],
                        }),
                      )
                      .catch((error) =>
                        notifyRequestError(error, "重试解析失败"),
                      )
                      .finally(() => setRetrying(false));
                  }}
                >
                  重试解析
                </Button>
              )}
              {offset > 0 && (
                <Button
                  variant="ghost"
                  onPress={() => setOffset((value) => Math.max(0, value - 20))}
                >
                  上一页
                </Button>
              )}
              {result?.nextOffset != null && (
                <Button
                  variant="secondary"
                  onPress={() => setOffset(result.nextOffset!)}
                >
                  下一页
                </Button>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
