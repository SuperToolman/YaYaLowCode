"use client";

import { Extension, Node, mergeAttributes, type Editor, type JSONContent } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Paperclip, Xmark } from "@gravity-ui/icons";
import Image from "next/image";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { LocalAttachment } from "../submission-flow";

export type DraftAttachment = LocalAttachment & { mimeType?: string };
export type AgentDraftEditorHandle = { prepareFileInsertion: (x?: number, y?: number) => void };
type Props = {
  value: string;
  attachments: DraftAttachment[];
  disabled: boolean;
  onChange: (text: string) => void;
  onFiles?: (files: File[]) => void;
  onRemove?: (id: string) => void;
  onSend: () => void;
};

const plainContent = (text: string): JSONContent[] => text.split(/\r?\n/).map(line => ({
  type: "paragraph", content: line ? [{ type: "text", text: line }] : [],
}));

/** Inline attachment atoms use the same editor approach as IM, with Agent submission callbacks. */
export const AgentDraftEditor = forwardRef<AgentDraftEditorHandle, Props>(function AgentDraftEditor(props, ref) {
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  const syncing = useRef(false);
  const editorInstance = useRef<Editor | null>(null);
  const previews = useRef(new Map<string, { file: File; url: string }>());
  const editor = useEditor({
    immediatelyRender: false,
    editable: !props.disabled,
    content: { type: "doc", content: plainContent(props.value) },
    extensions: [
      StarterKit.configure({ heading: false, blockquote: false, bulletList: false, orderedList: false, codeBlock: false, code: false, bold: false, italic: false, strike: false, horizontalRule: false, link: false, underline: false, undoRedo: false }),
      Placeholder.configure({ placeholder: "输入消息，或拖入图片、文件…" }),
      Extension.create({
        name: "agentTextLimit",
        addProseMirrorPlugins: () => [new Plugin({
          filterTransaction: (transaction, state) => !transaction.docChanged
            || transaction.doc.textBetween(0, transaction.doc.content.size, "\n", "").length
              <= Math.max(16000, state.doc.textBetween(0, state.doc.content.size, "\n", "").length),
        })],
      }),
      Node.create({
        name: "agentAttachment", group: "inline", inline: true, atom: true, draggable: true,
        addAttributes: () => ({ id: { default: "" }, name: { default: "" }, size: { default: 0 }, url: { default: "" }, status: { default: "" }, locked: { default: false } }),
        parseHTML: () => [{ tag: "span[data-agent-attachment]" }],
        renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-agent-attachment": "" })],
        renderText: () => "",
        addNodeView: () => ReactNodeViewRenderer(function AttachmentView({ node, selected }) {
          const { id, name, size, url, status } = node.attrs;
          return (
            <NodeViewWrapper as="span" contentEditable={false} data-drag-handle className={`relative mx-1 my-1 inline-flex max-w-[calc(100%-0.5rem)] cursor-grab items-center gap-2 rounded-lg bg-[var(--color-bg-surface)] p-2 align-bottom shadow-sm active:cursor-grabbing ${selected ? "outline-2 outline-app-primary" : ""}`}>
              {url ? (
                <Image src={url} alt={name} width={160} height={112} unoptimized draggable={false} className="max-h-28 w-auto max-w-40 rounded-md object-contain" />
              ) : <Paperclip className="size-5 shrink-0 text-muted" aria-hidden="true" />}
              <span className="min-w-0 max-w-40 text-xs">
                <span className="block truncate font-medium" title={name}>{name}</span>
                <span className="block text-muted">{size >= 1048576 ? `${(size / 1048576).toFixed(1)} MiB` : `${Math.max(1, Math.ceil(size / 1024))} KiB`}</span>
                {status ? <span className="block text-muted">{status}</span> : null}
              </span>
              <button type="button" aria-label={`移除附件 ${name}`} disabled={node.attrs.locked}
                onMouseDown={event => event.preventDefault()}
                onClick={() => { if (!latest.current.disabled) latest.current.onRemove?.(id); }}
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-app-primary disabled:cursor-not-allowed disabled:opacity-50">
                <Xmark className="size-3.5" aria-hidden="true" />
              </button>
            </NodeViewWrapper>
          );
        }),
      }),
    ],
    onUpdate: ({ editor }) => {
      if (syncing.current) return;
      const text = editor.getText({ blockSeparator: "\n" });
      latest.current.onChange(text);
      const ids = new Set<string>();
      editor.state.doc.descendants(node => { if (node.type.name === "agentAttachment") ids.add(node.attrs.id); });
      for (const file of latest.current.attachments) if (!ids.has(file.id)) latest.current.onRemove?.(file.id);
    },
    editorProps: {
      attributes: { role: "textbox", "aria-label": "发送给 AI 员工", "aria-multiline": "true", class: "min-h-12 outline-none whitespace-pre-wrap [overflow-wrap:anywhere] [&_p]:m-0 [&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]" },
      handlePaste: (view, event) => {
        if (latest.current.disabled) return true;
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length && latest.current.onFiles) {
          event.preventDefault(); latest.current.onFiles(files); return true;
        }
        // Treat copied HTML as plain text; pasted foreign attachment nodes are never trusted.
        const text = event.clipboardData?.getData("text/plain");
        if (text !== undefined) {
          event.preventDefault();
          editorInstance.current?.commands.insertContent(plainContent(text));
          return true;
        }
        return false;
      },
      handleKeyDown: (view, event) => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing || view.composing || event.keyCode === 229) return false;
        event.preventDefault();
        if (!latest.current.disabled) latest.current.onSend();
        return true;
      },
    },
  });
  useLayoutEffect(() => { editorInstance.current = editor; }, [editor]);

  useEffect(() => {
    if (!editor) return;
    let disposed = false;
    // React node views must mount after the current React effect has completed.
    queueMicrotask(() => {
      if (disposed || editor.isDestroyed) return;
      editor.setEditable(!props.disabled, false);
      const assets = new Map(props.attachments.map(file => [file.id, file]));
      for (const [id, preview] of previews.current) {
        if (assets.get(id)?.file !== preview.file) {
          URL.revokeObjectURL(preview.url);
          previews.current.delete(id);
        }
      }
      for (const file of props.attachments) {
        if (file.file?.type.startsWith("image/") && !previews.current.has(file.id)) {
          previews.current.set(file.id, { file: file.file, url: URL.createObjectURL(file.file) });
        }
      }
      const attrs = (file: DraftAttachment) => ({ id: file.id, name: file.name, size: file.size, url: previews.current.get(file.id)?.url ?? "", status: file.status ?? "", locked: props.disabled });
      syncing.current = true;
      try {
        if (editor.getText({ blockSeparator: "\n" }) !== props.value) {
          editor.commands.setContent({ type: "doc", content: plainContent(props.value) }, { emitUpdate: false });
        }
        const tr = editor.state.tr;
        const ids = new Set<string>();
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name !== "agentAttachment") return;
          const file = assets.get(node.attrs.id);
          if (!file) tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize));
          else {
            ids.add(file.id);
            const next = attrs(file);
            if (JSON.stringify(node.attrs) !== JSON.stringify(next)) tr.setNodeMarkup(tr.mapping.map(pos), undefined, next);
          }
        });
        if (tr.docChanged) editor.view.dispatch(tr);
        const added = props.attachments.filter(file => !ids.has(file.id));
        if (added.length) editor.commands.insertContentAt(editor.state.selection.to, added.map(file => ({ type: "agentAttachment", attrs: attrs(file) })));
      } finally { syncing.current = false; }
    });
    return () => { disposed = true; };
  }, [editor, props.value, props.attachments, props.disabled]);

  useEffect(() => {
    const urls = previews.current;
    return () => { for (const preview of urls.values()) URL.revokeObjectURL(preview.url); urls.clear(); };
  }, []);
  useImperativeHandle(ref, () => ({ prepareFileInsertion(x, y) {
    if (!editor || latest.current.disabled) return;
    if (x !== undefined && y !== undefined) {
      const position = editor.view.posAtCoords({ left: x, top: y });
      if (position) editor.commands.setTextSelection(position.pos);
    }
    editor.commands.focus(undefined, { scrollIntoView: false });
  } }), [editor]);

  return <EditorContent editor={editor} className="max-h-64 min-h-12 min-w-0 overflow-y-auto text-sm leading-6 [&_.ProseMirror-selectednode]:outline-2 [&_.ProseMirror-selectednode]:outline-app-primary" />;
});
