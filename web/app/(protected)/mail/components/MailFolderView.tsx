"use client";
import { notifyRequestError } from "@lib/notify";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Description, ScrollShadow } from "@heroui/react";
import { notify } from "@lib/notify";
import { listMailMessages, getMailMessage, type MailPageResponse, type MailDetailResponse, type MailMessageIdentity } from "@features/mail/api";
import { MailTable } from "./MailTable";
import { MailDetailDrawer } from "./MailDetailDrawer";

type Props = { folder: string; label: string; emptyText: string };
export function MailFolderView({ folder, label, emptyText }: Props) {
  const [page, setPage] = useState<MailPageResponse | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const morePending = useRef(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState<MailDetailResponse | null>(null);
  const [detailMessage, setDetailMessage] = useState<MailMessageIdentity | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const generation = useRef(0);
  const detailGeneration = useRef(0);
  const validity = useRef<number | undefined>(undefined);
  const load = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true); setFailed(false); setMoreFailed(false);
    morePending.current = false; setLoadingMore(false);
    try {
      const result = await listMailMessages({ folder });
      if (token !== generation.current) return;
      validity.current = result.uidValidity;
      setPage(result);
    } catch (cause) {
      if (token !== generation.current) return;
      setFailed(true);
      notifyRequestError(cause, cause instanceof Error ? cause.message : "邮件读取失败");
    } finally { if (token === generation.current) setLoading(false); }
  }, [folder]);
  useEffect(() => {
    // Fetch remote mailbox data when the folder changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const requestGeneration = generation;
    const detailRequestGeneration = detailGeneration;
    return () => { requestGeneration.current++; detailRequestGeneration.current++; };
  }, [load]);
  const loadMore = useCallback(async () => {
    if (loading || morePending.current || !page?.nextBeforeUid) return;
    morePending.current = true; setLoadingMore(true); setMoreFailed(false);
    const token = generation.current;
    try {
      const result = await listMailMessages({ folder, beforeUid: page.nextBeforeUid, uidValidity: page.uidValidity });
      if (token !== generation.current) return;
      setPage(current => current ? { ...result, items: [...new Map([...current.items, ...result.items].map(item => [item.id, item])).values()] } : result);
    } catch (cause) {
      if (token === generation.current) { setMoreFailed(true); notifyRequestError(cause, cause instanceof Error ? cause.message : "邮件加载失败"); }
    } finally {
      if (token === generation.current) { morePending.current = false; setLoadingMore(false); }
    }
  }, [folder, loading, page]);
  async function openDetail(id: string) {
    if (!page || loading) return;
    const token = ++detailGeneration.current;
    setDetailMessage({ uid: Number(id), folder, uidValidity: page.uidValidity });
    setDetailOpen(true); setDetail(null); setDetailLoading(true);
    try {
      const result = await getMailMessage(Number(id), { folder, uidValidity: page.uidValidity });
      if (token === detailGeneration.current) setDetail(result);
    } catch (cause) {
      if (token === detailGeneration.current) { setDetailOpen(false); notifyRequestError(cause, cause instanceof Error ? cause.message : "邮件详情读取失败"); }
    } finally { if (token === detailGeneration.current) setDetailLoading(false); }
  }
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
    <div className="flex shrink-0 items-center justify-between gap-3"><Description>{page?.notice || "从当前主邮箱实时读取"}</Description><Button variant="ghost" isDisabled={loading} onPress={() => { detailGeneration.current++; setDetailOpen(false); void load(); }}>刷新</Button></div>
    <ScrollShadow className="h-0 min-h-0 flex-1 overflow-auto overscroll-contain" aria-label="邮件滚动列表">
      {failed && !page ? <div className="p-8 text-center"><p>邮件读取失败，请刷新重试</p></div> : <MailTable key={`${folder}:${page?.uidValidity ?? "initial"}`} items={page?.items ?? []} label={label} emptyText={page?.notice || emptyText} sent={folder === "sent"} loading={loading} loadingMore={loadingMore} hasMore={!!page?.nextBeforeUid && !moreFailed} onLoadMore={() => void loadMore()} onOpen={(id) => void openDetail(id)} />}
      {moreFailed ? <div className="flex justify-center py-2"><Button variant="ghost" onPress={() => void loadMore()}>重试加载</Button></div> : page?.items.length && !page.nextBeforeUid && !loading ? <p className="py-2 text-center text-xs text-[var(--color-text-secondary)]">已加载全部邮件</p> : null}
    </ScrollShadow>
    <MailDetailDrawer open={detailOpen} loading={detailLoading} detail={detail} message={detailMessage} onOpenChange={(open) => { setDetailOpen(open); if (!open) detailGeneration.current++; }} />
  </div>;
}
