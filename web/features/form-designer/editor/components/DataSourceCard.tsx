"use client";

import { useId, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Button, Input, Label, ListBox, Select, TextArea } from "@heroui/react";
import { ArrowChevronRight, Copy, Grip, Pencil, TrashBin } from "@gravity-ui/icons";
import { MySurface } from "@/shared/ui/MySurface";
import type { DesignerDataSource } from "../designer-types";

type DataSourceCardProps = {
  source: DesignerDataSource;
  names: string[];
  onChange: (source: DesignerDataSource) => void;
  onCopy: () => void;
  onDelete: () => void;
};

export function DataSourceCard({ source, names, onChange, onCopy, onDelete }: DataSourceCardProps) {
  const detailsId = useId();
  const nameId = useId();
  const valueId = useId();
  const descriptionId = useId();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<DesignerDataSource | null>(null);
  const [error, setError] = useState("");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: source.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: source.id });

  function save() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name || names.includes(name)) {
      setError(name ? "变量名称已存在" : "请输入变量名称");
      return;
    }
    onChange({ ...draft, name });
    setDraft(null);
    setError("");
  }

  return (
    <div ref={setDropRef} className={isOver && !isDragging ? "rounded-lg outline-2 outline-[var(--color-primary)]" : ""}>
      <MySurface
        ref={setNodeRef}
        className={`relative min-w-0 rounded-lg p-2 ${isDragging ? "z-10 opacity-70 shadow-lg" : ""}`}
        style={transform ? { transform: `translate3d(0, ${transform.y}px, 0)` } : undefined}
      >
        <div className="flex min-w-0 items-center gap-0.5">
          <Button ref={setActivatorNodeRef} {...attributes} {...listeners} isIconOnly size="sm" variant="ghost"
            aria-label={`拖拽排序 ${source.name}`}
            className="touch-none cursor-grab text-[var(--color-text-secondary)] active:cursor-grabbing">
            <Grip />
          </Button>
          <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start gap-1 px-1"
            aria-expanded={expanded} aria-controls={detailsId} onPress={() => setExpanded(!expanded)}>
            <ArrowChevronRight className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
            <span className="shrink-0 text-xs text-[var(--color-success)]">变量</span>
            <span className="truncate" title={source.name}>{source.name}</span>
          </Button>
          <Button isIconOnly size="sm" variant="ghost" aria-label={`编辑 ${source.name}`}
            onPress={() => { setDraft({ ...source }); setExpanded(true); setError(""); }}><Pencil /></Button>
          <Button isIconOnly size="sm" variant="ghost" aria-label={`复制 ${source.name}`} onPress={onCopy}><Copy /></Button>
          <Button isIconOnly size="sm" variant="ghost" aria-label={`删除 ${source.name}`}
            className="text-[var(--color-danger)]" onPress={onDelete}><TrashBin /></Button>
        </div>
        <div id={detailsId} hidden={!expanded}>
          {draft ? (
            <div className="mt-3 flex flex-col gap-3 border-t border-[var(--color-border)] pt-3">
              <div className="grid min-w-0 grid-cols-3 items-end gap-2">
              <div className="flex min-w-0 flex-col gap-1">
                <Label htmlFor={nameId}>变量名称</Label>
                <Input id={nameId} value={draft.name} fullWidth onChange={event => setDraft({ ...draft, name: event.currentTarget.value })} />
              </div>
              <Select className="min-w-0" aria-label="变量类型" selectedKey={draft.kind} fullWidth
                onSelectionChange={key => { if (key) setDraft({ ...draft, kind: String(key) as DesignerDataSource["kind"] }); }}>
                <Label>变量类型</Label>
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover><ListBox>{["string", "number", "boolean", "object"].map(kind => (
                  <ListBox.Item id={kind} key={kind} textValue={kind}>{kind}</ListBox.Item>
                ))}</ListBox></Select.Popover>
              </Select>
              <div className="flex min-w-0 flex-col gap-1">
                <Label htmlFor={descriptionId}>描述</Label>
                <Input id={descriptionId} fullWidth value={draft.description ?? ""}
                  onChange={event => setDraft({ ...draft, description: event.currentTarget.value })} />
              </div>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={valueId}>初始值</Label>
                <TextArea id={valueId} fullWidth rows={3} value={draft.initialValue}
                  onChange={event => setDraft({ ...draft, initialValue: event.currentTarget.value })} />
              </div>
              {error ? <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onPress={() => { setDraft(null); setError(""); }}>取消</Button>
                <Button size="sm" onPress={save}>保存</Button>
              </div>
            </div>
          ) : (
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-[var(--color-border)] px-1 pt-3 text-xs leading-5">
              <dt className="text-[var(--color-text-secondary)]">描述</dt><dd className="break-words">{source.description || "暂无描述"}</dd>
              <dt className="text-[var(--color-text-secondary)]">类型</dt><dd>{source.kind}</dd>
              <dt className="text-[var(--color-text-secondary)]">初始值</dt><dd className="whitespace-pre-wrap break-all font-mono">{source.initialValue || "（空）"}</dd>
            </dl>
          )}
        </div>
      </MySurface>
    </div>
  );
}
