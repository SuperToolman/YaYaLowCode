"use client";

import { Button, ScrollShadow } from "@heroui/react";
import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Remount per session. Prepending history preserves position; streaming only
 * follows the bottom while the reader has not scrolled up. */
export function ConversationViewport({ loaded, hasOlder, loadingOlder, onLoadOlder, children }: {
  loaded: boolean; hasOlder: boolean; loadingOlder: boolean; onLoadOlder: () => void; children: ReactNode;
}) {
  const viewport=useRef<HTMLDivElement>(null);
  const content=useRef<HTMLDivElement>(null);
  const initialized=useRef(false);
  const follow=useRef(true);
  const previousHeight=useRef<number | null>(null);
  const loading=useRef(loadingOlder);

  useLayoutEffect(()=>{
    loading.current=loadingOlder;
    const element=viewport.current;
    if (!element || !loaded) return;
    if (previousHeight.current!==null) {
      if (!loadingOlder) {element.scrollTop+=element.scrollHeight-previousHeight.current;previousHeight.current=null;}
    } else if (!initialized.current || follow.current) {
      element.scrollTop=element.scrollHeight;
      initialized.current=true;
    }
  });
  useLayoutEffect(()=>{
    if (!content.current) return;
    const observer=new ResizeObserver(()=>{
      if (viewport.current && initialized.current && follow.current && !loading.current && previousHeight.current===null) viewport.current.scrollTop=viewport.current.scrollHeight;
    });
    observer.observe(content.current);
    return ()=>observer.disconnect();
  },[]);

  function older() {
    if (!viewport.current || loadingOlder) return;
    previousHeight.current=viewport.current.scrollHeight;
    follow.current=false;
    onLoadOlder();
  }
  return <ScrollShadow ref={viewport} className="h-full [overflow-anchor:none]" aria-label="会话消息" onScroll={()=>{
    const element=viewport.current;
    if(element)follow.current=element.scrollHeight-element.scrollTop-element.clientHeight<64;
  }}><div ref={content} className="flex flex-col gap-3" aria-live="polite">
    {!loaded ? <p role="status">正在加载消息…</p> : hasOlder ? <Button variant="ghost" onPress={older} isDisabled={loadingOlder}>{loadingOlder ? "正在读取历史消息…" : "查看更早的消息"}</Button> : null}
    {children}
  </div></ScrollShadow>;
}
