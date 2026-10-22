"use client";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Button, Card } from "@heroui/react";
import type { CommunicationConversationResponse } from "@features/communication/api";
import { AttachmentPreview } from "./AttachmentPreview";
import type { DraftAsset } from "./draft";
import styles from "./message-send-box.module.css";
export type MentionComposerHandle = { insertText: (text: string) => void; insertFiles: (files: File[]) => void };
type Props = { value: JSONContent; assets: Map<string, DraftAsset>; members: CommunicationConversationResponse["members"]; disabled: boolean; onChange: (doc: JSONContent) => void; onFiles: (files: File[]) => string[]; onSend: () => void };
export const MentionComposer = forwardRef<MentionComposerHandle, Props>(function MentionComposer(props, ref) {
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  const [query, setQuery] = useState<string | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: false, blockquote: false, bulletList: false, orderedList: false, codeBlock: false, code: false, bold: false, italic: false, strike: false, horizontalRule: false, link: false, underline: false, undoRedo: false }), Placeholder.configure({ placeholder: "输入消息" }),
      Node.create({ name: "attachment", group: "inline", inline: true, atom: true,
        addAttributes: () => ({ id: { default: null } }),
        parseHTML: () => [{ tag: "span[data-draft-attachment]" }],
        renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-draft-attachment": "" })],
        addNodeView: () => ReactNodeViewRenderer(function AttachmentView({ node }) { return <NodeViewWrapper as="span" className="mx-1 my-1 inline-block max-w-[calc(100%-0.5rem)] align-bottom"><AttachmentPreview asset={latest.current.assets.get(node.attrs.id)} /></NodeViewWrapper>; }),
      }),
      Node.create({ name: "mention", group: "inline", inline: true, atom: true,
        addAttributes: () => ({ id: { default: null }, label: { default: "" } }),
        parseHTML: () => [{ tag: "span[data-draft-mention]" }],
        renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-draft-mention": "" }), `@${node.attrs.label}`],
        renderText: ({ node }) => `@${node.attrs.label}`,
      })],
    content: props.value,
    editable: !props.disabled,
    onUpdate: ({ editor }) => latest.current.onChange(editor.getJSON()),
    onSelectionUpdate: ({ editor }) => {
      const { from, $from } = editor.state.selection;
      const before = editor.state.doc.textBetween($from.start(), from, "", "\ufffc");
      setQuery(before.match(/@([^\s@]*)$/)?.[1] ?? null);
    },
    editorProps: {
      attributes: { role: "textbox", "aria-label": "消息内容", "aria-multiline": "true" },

      handleDOMEvents: {
        copy: (view, event) => {
          if (!event.clipboardData || view.state.selection.empty) return false;
          event.preventDefault();
          event.clipboardData.setData("application/x-yaya-message-draft", JSON.stringify(view.state.selection.content().toJSON()));
          event.clipboardData.setData("text/plain", view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, "\n", node => node.type.name === "mention" ? `@${node.attrs.label}` : latest.current.assets.get(node.attrs.id)?.name ?? ""));
          return true;
        },
        cut: (view, event) => {
          if (latest.current.disabled || !event.clipboardData || view.state.selection.empty) return false;
          event.preventDefault();
          event.clipboardData.setData("text/plain", view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, "\n", node => node.type.name === "mention" ? `@${node.attrs.label}` : latest.current.assets.get(node.attrs.id)?.name ?? ""));
          view.dispatch(view.state.tr.deleteSelection());
          return true;
        },
      },
      handlePaste: (view, event) => {
        if (latest.current.disabled) return true;
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length) { event.preventDefault(); const ids = latest.current.onFiles(files); editor?.commands.insertContent(ids.map(id => ({ type: "attachment", attrs: { id } }))); return true; }
        const internal = event.clipboardData?.getData("application/x-yaya-message-draft");
        if (internal) {
          try {
            const content = JSON.parse(internal).content as JSONContent[];
            const valid = (nodes: JSONContent[]): boolean => nodes.every(node => ["paragraph", "text", "hardBreak", "mention", "attachment"].includes(node.type ?? "") && (node.type !== "attachment" || latest.current.assets.has(node.attrs?.id)) && (!node.content || valid(node.content)));
            if (Array.isArray(content) && valid(content)) { event.preventDefault(); editor?.commands.insertContent(content); return true; }
          } catch { /* Fall back to plain text for stale or foreign clipboard content. */ }
        }
        event.preventDefault(); const text = event.clipboardData?.getData("text/plain") ?? "";
        editor?.commands.insertContent(text.split(/\r?\n/).flatMap((line, index) => [...(index ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])])); return true;
      },
    },
  });
  useEffect(() => { editor?.setEditable(!props.disabled, false); }, [editor, props.disabled]);
  useEffect(() => { if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(props.value)) editor.commands.setContent(props.value, { emitUpdate: false }); }, [editor, props.value]);
  useImperativeHandle(ref, () => ({ insertText: text => { if (!latest.current.disabled) editor?.chain().focus().insertContent({ type: "text", text }).run(); }, insertFiles: files => { if (!latest.current.disabled) { const ids = latest.current.onFiles(files); editor?.chain().focus().insertContent(ids.map(id => ({ type: "attachment", attrs: { id } }))).run(); } } }));
  const members = query === null ? [] : props.members.filter(m => m.displayName.toLowerCase().includes(query.toLowerCase()));
  function mention(id: string, label: string) { if (!editor || query === null) return; const end = editor.state.selection.from; editor.chain().focus().insertContentAt({ from: end - query.length - 1, to: end }, [{ type: "mention", attrs: { id, label } }, { type: "text", text: " " }]).run(); setQuery(null); }
  return <div className="relative min-h-0 overflow-y-auto p-3" onKeyDownCapture={event => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || editor?.view.composing || event.keyCode === 229) return;
    event.preventDefault(); event.stopPropagation();
    if (!latest.current.disabled) latest.current.onSend();
  }}><EditorContent editor={editor} className={styles.editor} />{query !== null && props.members.length > 0 && !props.disabled ? <Card className="absolute bottom-2 left-2 z-20 max-h-48 w-64 overflow-y-auto p-2">{query === "" ? <Button onPress={() => mention("all", "所有人")}>@所有人</Button> : null}{members.map(m => <Button key={m.userId} onPress={() => mention(m.userId, m.displayName)}>{m.displayName}</Button>)}</Card> : null}</div>;
});
