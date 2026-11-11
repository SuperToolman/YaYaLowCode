import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { MessageBubbleMain } from "./MessageBubbleMain";
import type { MessageBubbleProps } from "./message-bubble-types";
export type { BubbleMessage, MessageBubbleProps } from "./message-bubble-types";
export { MessageAvatar, MessageAttachments, MessageBubbleContent } from "./MessageBubbleContent";

export function MessageBubble(props: MessageBubbleProps) {
  const {
    message,
    mine,
    canRecall,
    onRecall,
    onReedit,
    onRetry,
  } = props;
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const recalled = message.status === "recalled";
  const canOpenActions =
    mine && (canRecall || recalled || message.deliveryState === "failed");
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);
  return (
    <>
      <MessageBubbleMain
        {...props}
        onContextMenu={(event) => {
          if (!canOpenActions) return;
          event.preventDefault();
          setMenu({
            left: Math.min(event.clientX, window.innerWidth - 128),
            top: Math.min(event.clientY, window.innerHeight - 96),
          });
        }}
      />
      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 flex flex-col"
          style={{ left: menu.left, top: menu.top }}
        >
          {message.deliveryState === "failed" ? (
            <Button
              onPress={() => {
                setMenu(null);
                onRetry();
              }}
            >
              重新发送
            </Button>
          ) : null}
          {recalled ? (
            <Button
              onPress={() => {
                setMenu(null);
                onReedit();
              }}
            >
              重新编辑
            </Button>
          ) : canRecall ? (
            <Button
              onPress={() => {
                setMenu(null);
                onRecall();
              }}
            >
              撤回
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
