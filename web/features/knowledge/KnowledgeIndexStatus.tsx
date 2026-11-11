"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { useAuth } from "@/features/auth/components/AuthProvider";
import { notifyRequestError } from "@/shared/lib/notify";
import { readRetrievalSettings, retryVectorIndex } from "./client";
import { retrievalReason } from "./retrieval-status";
export function KnowledgeIndexStatus({
  baseId,
  canManage,
}: {
  baseId: string;
  canManage: boolean;
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["knowledge", user?.id, "retrieval", baseId],
    queryFn: ({ signal }) => readRetrievalSettings(signal, baseId),
    refetchInterval: 5000,
  });
  const settings = query.data;
  if (query.isError)
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        检索状态加载失败
        <Button size="sm" variant="ghost" onPress={() => void query.refetch()}>
          重试
        </Button>
      </div>
    );
  if (!settings) return <p className="text-xs text-muted">正在加载检索状态…</p>;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-bg-subtle)]/50 p-3 text-xs text-muted">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <span>
          嵌入：
          {settings.config.enabled
            ? settings.config.embeddingModel
            : "沿用关键词检索"}
        </span>
        <span>重排序：{settings.config.rerankerModel || "未启用"}</span>
      </div>
      {settings.profileId && (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            向量索引：已就绪 {settings.ready} · 构建中 {settings.pending} · 失败{" "}
            {settings.failed}
          </span>
          {settings.failed > 0 && canManage && (
            <Button
              size="sm"
              variant="ghost"
              isDisabled={busy}
              onPress={() => {
                setBusy(true);
                void retryVectorIndex(baseId)
                  .then(() => query.refetch())
                  .catch((error) => notifyRequestError(error, "重试索引失败"))
                  .finally(() => setBusy(false));
              }}
            >
              重试失败项
            </Button>
          )}
          {settings.lastError && (
            <span>{retrievalReason(settings.lastError)}</span>
          )}
        </div>
      )}
    </div>
  );
}
