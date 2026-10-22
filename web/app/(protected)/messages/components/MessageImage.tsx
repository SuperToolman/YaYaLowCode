"use client";
import { notifyRequestError } from "@lib/notify";

/* eslint-disable @next/next/no-img-element -- authenticated original image URLs */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Button } from "@heroui/react";
import { listCommunicationMessages, type CommunicationMessageResponse } from "@features/communication/api";
import styles from "./MessageImage.module.css";
import { notify } from "@lib/notify";
import { messageImages, type ConversationImage } from "./message-images";
const Viewer = dynamic(() => import("./MessageImageViewer"), { ssr: false });
const GalleryContext = createContext<((image: ConversationImage) => void) | null>(null);

export function MessageImageGallery({ conversationId, messages, children }: { conversationId: string; messages: CommunicationMessageResponse[]; children: ReactNode }) {
  return <GallerySession key={conversationId} conversationId={conversationId} messages={messages}>{children}</GallerySession>;
}
function GallerySession({ conversationId, messages, children }: { conversationId: string; messages: CommunicationMessageResponse[]; children: ReactNode }) {
  const [active, setActive] = useState<ConversationImage | null>(null);
  const [history, setHistory] = useState<CommunicationMessageResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const merged = new Map(history.map(message => [message.id, message]));
  messages.forEach(message => merged.set(message.id, message));
  const images = messageImages([...merged.values()]);
  if (active && !images.some(image => image.id === active.id)) images.push(active);
  function close() { controller.current?.abort(); controller.current = null; setLoading(false); setActive(null); }
  function open(image: ConversationImage) {
    setActive(image);
    if (loading) return;
    const request = new AbortController(); controller.current?.abort(); controller.current = request; setLoading(true);
    void (async () => {
      let beforeSequence: number | undefined;
      const all = new Map<string, CommunicationMessageResponse>();
      do {
        const result = await listCommunicationMessages({ path: { conversationId }, query: { limit: 100, beforeSequence }, signal: request.signal });
        if (request.signal.aborted) return;
        if (result.error || !result.data?.data) throw new Error("无法加载会话历史图片");
        const page = result.data.data;
        page.items.forEach(message => all.set(message.id, message));
        setHistory([...all.values()]);
        const next = page.nextBeforeSequence ?? undefined;
        if (next === undefined || next === beforeSequence || !page.items.length) break;
        beforeSequence = next;
      } while (!request.signal.aborted);
    })().catch(error => { if (!request.signal.aborted) notifyRequestError(error, "图片预览加载失败", { description: error instanceof Error ? error.message : "请稍后重试" }); }).finally(() => { if (controller.current === request) setLoading(false); });
  }
  return <GalleryContext.Provider value={open}>{children}{active ? <Viewer images={images} activeId={active.id} onClose={close} onView={id => setActive(current => current?.id === id ? current : images.find(image => image.id === id) ?? null)} /> : null}</GalleryContext.Provider>;
}
export function MessageImage({ imageId, src, alt }: { imageId: string; src: string; alt: string }) {
  const open = useContext(GalleryContext);
  const [broken, setBroken] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const image = { id: imageId, src, alt };
  return <>
    <Button variant="ghost" className={`h-auto min-w-0 max-w-full overflow-hidden rounded-[inherit] p-0 ${styles.image}`} aria-label={`查看图片：${alt}`} onPress={() => open ? open(image) : setLocalOpen(true)}>
      {broken ? <span>图片加载失败：{alt}</span> : <img src={src} alt={alt} loading="lazy" className="block max-h-64 max-w-full object-contain" onError={() => setBroken(true)} />}
      {!broken ? <span className={styles.caption} aria-hidden="true">{alt}</span> : null}
    </Button>
    {localOpen ? <Viewer images={[image]} activeId={imageId} onClose={() => setLocalOpen(false)} onView={() => {}} /> : null}
  </>;
}
