"use client";

import { useEffect } from "react";
import {
  ArrowUturnCcwLeft,
  ArrowUturnCwRight,
  Bold,
  BroomMotion,
  Italic,
  LayoutHeaderColumns,
  Link as LinkIcon,
  ListCheck,
  ListOl,
  ListUl,
  Picture,
  Plus,
  QuoteClose,
  SquareLineHorizontal,
  Strikethrough,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TrashBin,
  Underline as UnderlineIcon,
} from "@gravity-ui/icons";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import { BackgroundColor, FontSize, TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Placeholder from "@tiptap/extension-placeholder";

export type RichTextDocument = { type: "doc"; content: Array<Record<string, unknown>> };

const EMPTY_DOCUMENT: RichTextDocument = { type: "doc", content: [] };
const FONT_FAMILIES = ["默认", "Arial", "Microsoft YaHei", "SimSun", "monospace"];
const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "32px"];

export function RichTextEditor({ ariaLabel, disabled = false, onChange, preview = false, readOnly = false, value }: {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: RichTextDocument) => void;
  preview?: boolean;
  readOnly?: boolean;
  value: RichTextDocument;
}) {
  const editable = !disabled && !readOnly;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Underline,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      BackgroundColor,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: !editable, autolink: true, linkOnPaste: true }),
      Image.configure({ allowBase64: false, resize: { enabled: true, minWidth: 100, minHeight: 80 } }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: "请输入" }),
    ],
    content: value ?? EMPTY_DOCUMENT,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class: "rich-text-content min-h-28 px-3 py-2 text-sm leading-6 text-[var(--color-text-primary)] outline-none",
      },
    },
    onUpdate: ({ editor: nextEditor }) => onChange(nextEditor.getJSON() as RichTextDocument),
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor) return;
    const nextValue = JSON.stringify(value ?? EMPTY_DOCUMENT);
    if (JSON.stringify(editor.getJSON()) !== nextValue) {
      editor.commands.setContent(value ?? EMPTY_DOCUMENT, { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) {
    return <div aria-label="富文本加载中" className="flex min-h-32 w-full animate-pulse flex-col rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)]"><div className="h-9 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)]" /><div className="m-3 h-4 w-2/5 rounded bg-[var(--color-bg-subtle)]" /></div>;
  }

  return (
    <div className="flex h-full min-h-32 w-full flex-col overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)]">
      {(editable || preview) ? <RichTextToolbar disabled={!editable} editor={editor} /> : null}
      <EditorContent className="min-h-0 flex-1 overflow-auto" editor={editor} />
    </div>
  );
}

function RichTextToolbar({ disabled, editor }: { disabled: boolean; editor: NonNullable<ReturnType<typeof useEditor>> }) {
  const execute = (action: () => void) => { if (!disabled) action(); };
  const setLink = () => {
    if (disabled) return;
    const url = window.prompt("链接地址", (editor.getAttributes("link").href as string | undefined) ?? "");
    if (url === null) return;
    if (!url.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };
  const setImage = () => {
    if (disabled) return;
    const src = window.prompt("图片地址");
    if (src?.trim()) editor.chain().focus().setImage({ src: src.trim() }).run();
  };

  return <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] px-2 py-1">
    <ToolbarButton disabled={disabled} label="撤销" onClick={() => execute(() => editor.chain().focus().undo().run())}><ArrowUturnCcwLeft /></ToolbarButton>
    <ToolbarButton disabled={disabled} label="重做" onClick={() => execute(() => editor.chain().focus().redo().run())}><ArrowUturnCwRight /></ToolbarButton>
    <ToolbarButton disabled={disabled} label="清除格式" onClick={() => execute(() => editor.chain().focus().unsetAllMarks().clearNodes().run())}><BroomMotion /></ToolbarButton>
    <ToolbarSelect disabled={disabled} label="段落样式" value={editor.isActive("heading", { level: 1 }) ? "h1" : editor.isActive("heading", { level: 2 }) ? "h2" : editor.isActive("heading", { level: 3 }) ? "h3" : "p"} onChange={(value) => execute(() => value === "p" ? editor.chain().focus().setParagraph().run() : editor.chain().focus().toggleHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run())} options={[{ value: "p", label: "正文" }, { value: "h1", label: "标题 1" }, { value: "h2", label: "标题 2" }, { value: "h3", label: "标题 3" }]} />
    <ToolbarSelect disabled={disabled} label="字体" value={(editor.getAttributes("textStyle").fontFamily as string | undefined) ?? "默认"} onChange={(value) => execute(() => value === "默认" ? editor.chain().focus().unsetFontFamily().run() : editor.chain().focus().setFontFamily(value).run())} options={FONT_FAMILIES.map((value) => ({ value, label: value }))} />
    <ToolbarSelect disabled={disabled} label="字号" value={(editor.getAttributes("textStyle").fontSize as string | undefined) ?? "14px"} onChange={(value) => execute(() => editor.chain().focus().setFontSize(value).run())} options={FONT_SIZES.map((value) => ({ value, label: value.replace("px", "") }))} />
    <ToolbarButton active={editor.isActive("bold")} disabled={disabled} label="加粗" onClick={() => execute(() => editor.chain().focus().toggleBold().run())}><Bold /></ToolbarButton>
    <ToolbarButton active={editor.isActive("italic")} disabled={disabled} label="斜体" onClick={() => execute(() => editor.chain().focus().toggleItalic().run())}><Italic /></ToolbarButton>
    <ToolbarButton active={editor.isActive("strike")} disabled={disabled} label="删除线" onClick={() => execute(() => editor.chain().focus().toggleStrike().run())}><Strikethrough /></ToolbarButton>
    <ToolbarButton active={editor.isActive("underline")} disabled={disabled} label="下划线" onClick={() => execute(() => editor.chain().focus().toggleUnderline().run())}><UnderlineIcon /></ToolbarButton>
    <ColorInput disabled={disabled} label="文字颜色" value={(editor.getAttributes("textStyle").color as string | undefined) ?? "#1f2937"} onChange={(value) => execute(() => editor.chain().focus().setColor(value).run())} />
    <ColorInput disabled={disabled} label="背景颜色" value={(editor.getAttributes("textStyle").backgroundColor as string | undefined) ?? "#ffffff"} onChange={(value) => execute(() => editor.chain().focus().setBackgroundColor(value).run())} />
    <ToolbarButton active={editor.isActive("bulletList")} disabled={disabled} label="无序列表" onClick={() => execute(() => editor.chain().focus().toggleBulletList().run())}><ListUl /></ToolbarButton>
    <ToolbarButton active={editor.isActive("orderedList")} disabled={disabled} label="有序列表" onClick={() => execute(() => editor.chain().focus().toggleOrderedList().run())}><ListOl /></ToolbarButton>
    <ToolbarButton active={editor.isActive("taskList")} disabled={disabled} label="任务列表" onClick={() => execute(() => editor.chain().focus().toggleTaskList().run())}><ListCheck /></ToolbarButton>
    <ToolbarButton active={editor.isActive({ textAlign: "left" })} disabled={disabled} label="左对齐" onClick={() => execute(() => editor.chain().focus().setTextAlign("left").run())}><TextAlignLeft /></ToolbarButton>
    <ToolbarButton active={editor.isActive({ textAlign: "center" })} disabled={disabled} label="居中" onClick={() => execute(() => editor.chain().focus().setTextAlign("center").run())}><TextAlignCenter /></ToolbarButton>
    <ToolbarButton active={editor.isActive({ textAlign: "right" })} disabled={disabled} label="右对齐" onClick={() => execute(() => editor.chain().focus().setTextAlign("right").run())}><TextAlignRight /></ToolbarButton>
    <ToolbarButton active={editor.isActive("blockquote")} disabled={disabled} label="引用" onClick={() => execute(() => editor.chain().focus().toggleBlockquote().run())}><QuoteClose /></ToolbarButton>
    <ToolbarButton disabled={disabled} label="分割线" onClick={() => execute(() => editor.chain().focus().setHorizontalRule().run())}><SquareLineHorizontal /></ToolbarButton>
    <ToolbarButton active={editor.isActive("link")} disabled={disabled} label="链接" onClick={setLink}><LinkIcon /></ToolbarButton>
    <ToolbarButton disabled={disabled} label="插入图片地址" onClick={setImage}><Picture /></ToolbarButton>
    <ToolbarButton active={editor.isActive("table")} disabled={disabled} label="插入表格" onClick={() => execute(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}><LayoutHeaderColumns /></ToolbarButton>
    {editor.isActive("table") ? <><ToolbarButton disabled={disabled} label="插入行" onClick={() => execute(() => editor.chain().focus().addRowAfter().run())}><Plus /></ToolbarButton><ToolbarButton disabled={disabled} label="插入列" onClick={() => execute(() => editor.chain().focus().addColumnAfter().run())}><Plus /></ToolbarButton><ToolbarButton disabled={disabled} label="删除表格" onClick={() => execute(() => editor.chain().focus().deleteTable().run())}><TrashBin /></ToolbarButton></> : null}
  </div>;
}

function ToolbarButton({ active = false, children, disabled, label, onClick }: { active?: boolean; children: React.ReactNode; disabled: boolean; label: string; onClick: () => void }) {
  return <button aria-label={label} className={["flex h-7 shrink-0 items-center justify-center rounded px-1.5 text-xs hover:bg-[var(--color-bg-hover)] disabled:cursor-default disabled:opacity-50", active ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]" : "text-[var(--color-text-secondary)]"].join(" ")} disabled={disabled} title={label} type="button" onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>;
}

function ToolbarSelect({ disabled, label, onChange, options, value }: { disabled: boolean; label: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; value: string }) {
  return <select aria-label={label} className="h-7 shrink-0 rounded border-0 bg-transparent px-1 text-xs text-[var(--color-text-secondary)] outline-none disabled:opacity-50" disabled={disabled} value={value} onChange={(event) => onChange(event.currentTarget.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}

function ColorInput({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label aria-label={label} className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center disabled:cursor-default"><input aria-label={label} className="h-4 w-4 cursor-pointer bg-transparent p-0" disabled={disabled} type="color" value={value} onChange={(event) => onChange(event.currentTarget.value)} /></label>;
}
