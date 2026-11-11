"use client";

import { LayoutSideContentRight } from "@gravity-ui/icons";
import { Button, Card, Separator, Tooltip } from "@heroui/react";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 220;

export function AgentConversationLayout({ children, workspace, title = "新对话" }: { children: ReactNode; workspace: ReactNode; title?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const [preferredWidth, setPreferredWidth] = useState(DEFAULT_WIDTH);
  const [containerWidth, setContainerWidth] = useState(0);
  const [resizing, setResizing] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const workspaceId = useId();
  const maxWidth = Math.max(MIN_WIDTH, Math.min(480, (containerWidth || 1200) - 360 - 8));
  const width = Math.max(MIN_WIDTH, Math.min(maxWidth, preferredWidth));
  const clamp = (next: number) => Math.max(MIN_WIDTH, Math.min(maxWidth, next));
  const toggleLabel = workspaceOpen ? "收起会话工作区" : "展开会话工作区";

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Card aria-label="AgentV2 对话与工作区" className={`@container min-h-0 min-w-0 gap-0 overflow-hidden p-0 ${resizing ? "select-none" : ""}`}>
      <Card.Header className="min-w-0 shrink-0 flex-row items-center justify-between gap-3 px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>{title}</h2>
        <Tooltip>
          <Button type="button" isIconOnly size="sm" variant="ghost" aria-label={toggleLabel}
            aria-expanded={workspaceOpen} aria-controls={workspaceId}
            className={`shrink-0 ${workspaceOpen ? "bg-subtle text-foreground" : "text-muted"}`}
            onPress={() => {
              drag.current = null;
              setResizing(false);
              setWorkspaceOpen(open => !open);
            }}>
            <LayoutSideContentRight className="size-4" aria-hidden="true" />
          </Button>
          <Tooltip.Content>{toggleLabel}</Tooltip.Content>
        </Tooltip>
      </Card.Header>
      <div ref={container} style={{ "--workspace-width": `${width}px` } as CSSProperties}
        className="flex min-h-0 flex-1 flex-col @min-[48rem]:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4" aria-label="AgentV2 对话">
          {children}
        </div>
        {workspaceOpen ? <>
        <Separator className="shrink-0 @min-[48rem]:hidden" />
        <div role="separator" aria-label="调整工作区宽度" aria-orientation="vertical" aria-controls={workspaceId}
          aria-valuemin={MIN_WIDTH} aria-valuemax={maxWidth} aria-valuenow={width} aria-valuetext={`${width}像素`}
          tabIndex={0} title="拖动调整宽度，双击恢复默认宽度"
          className={`group relative hidden w-2 shrink-0 touch-none cursor-col-resize items-center justify-center self-stretch outline-none @min-[48rem]:flex ${resizing ? "bg-app-primary/10" : "hover:bg-app-primary/5"}`}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { pointer: event.pointerId, x: event.clientX, width };
            setResizing(true);
          }}
          onPointerMove={event => {
            if (drag.current?.pointer !== event.pointerId) return;
            setPreferredWidth(clamp(drag.current.width + drag.current.x - event.clientX));
          }}
          onPointerUp={event => {
            if (drag.current?.pointer !== event.pointerId) return;
            drag.current = null;
            setResizing(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { drag.current = null; setResizing(false); }}
          onLostPointerCapture={() => { drag.current = null; setResizing(false); }}
          onDoubleClick={() => setPreferredWidth(DEFAULT_WIDTH)}
          onKeyDown={event => {
            const step = event.shiftKey ? 48 : 16;
            const next = event.key === "ArrowLeft" ? width + step : event.key === "ArrowRight" ? width - step
              : event.key === "Home" ? MIN_WIDTH : event.key === "End" ? maxWidth : undefined;
            if (next === undefined) return;
            event.preventDefault();
            setPreferredWidth(clamp(next));
          }}>
          <Separator orientation="vertical" aria-hidden="true"
            className={`h-full transition-colors group-hover:bg-app-primary/50 group-focus-visible:bg-app-primary ${resizing ? "bg-app-primary" : ""}`} />
        </div>
        </> : null}
        <aside id={workspaceId} hidden={!workspaceOpen} aria-label="会话工作区面板" className="h-56 min-h-0 min-w-0 shrink-0 p-4 @min-[48rem]:h-auto @min-[48rem]:w-[var(--workspace-width)]">
          {workspace}
        </aside>
      </div>
    </Card>
  );
}
