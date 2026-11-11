"use client";

import { useEffect, useMemo } from "react";
import { createDocument } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { createRichTextExtensions } from "./rich-text-extensions";
import { RichTextToolbar } from "./RichTextToolbar";
import { richTextInput, richTextOutput, type RichTextDocument, type RichTextOutputMap, type RichTextOutputFormat } from "./rich-text-value";
import styles from "./RichTextEditor.module.css";

export type { RichTextDocument, RichTextOutputMap, RichTextOutputFormat } from "./rich-text-value";

export type RichTextEditorProps<F extends RichTextOutputFormat = "json"> = {
  ariaLabel: string;
  value: RichTextDocument | string | null;
  inputFormat?: "json" | "html" | "text";
  outputFormat?: F;
  onChange: (value: RichTextOutputMap[F]) => void;
  disabled?: boolean;
  readOnly?: boolean;
  preview?: boolean;
  placeholder?: string;
  showToolbar?: boolean;
  className?: string;
  contentClassName?: string;
};

/**
 * 基于 Tiptap 的公共受控富文本编辑器，表单和邮件共用扩展配置与工具栏。
 *
 * 使用方式：通过 value 回填内容，在 onChange 中更新业务状态。
 * - inputFormat：json（默认，传文档对象）、html、text；纯文本按字面插入。
 * - outputFormat：json（默认）、html、text，或 all（返回 { json, html, text }）。
 * - value 为 null 或空字符串时清空内容；外部回填和清空不会触发 onChange。
 * - disabled / readOnly 禁止编辑；showToolbar 控制工具栏，preview 可在只读时显示禁用工具栏。
 * - placeholder 设置提示文字；className / contentClassName 分别设置容器和编辑区样式。
 *
 * 输入和输出格式可以不同，但应使用匹配 inputFormat 的内容回填 value，
 * 避免将纯文本输出回填为富文本而丢失格式。图片上传和外部邮件 HTML 清理由业务层负责。
 *
 * @example 表单：默认输入、输出均为结构化 JSON
 * ```tsx
 * <RichTextEditor ariaLabel="内容" value={document} onChange={setDocument} />
 * ```
 *
 * @example 邮件：回填 HTML，同时获取 HTML 和纯文本
 * ```tsx
 * <RichTextEditor
 *   ariaLabel="正文"
 *   value={body.html}
 *   inputFormat="html"
 *   outputFormat="all"
 *   onChange={({ html, text }) => setBody({ html, text })}
 * />
 * ```
 */
export function RichTextEditor<F extends RichTextOutputFormat = "json">({
  ariaLabel, value, onChange, outputFormat, inputFormat = "json",
  disabled = false, readOnly = false, preview = false,
  placeholder = "请输入", showToolbar = true, className = "", contentClassName = "",
}: RichTextEditorProps<F>) {
  const editable = !disabled && !readOnly;
  const extensions = useMemo(() => createRichTextExtensions(placeholder), [placeholder]);
  const editor = useEditor({
    extensions,
    content: richTextInput(value, inputFormat),
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": ariaLabel,
        class: `${styles["rich-text-editor__content"]} min-h-28 px-3 py-2 text-sm leading-6 text-[var(--color-text-primary)] outline-none ${contentClassName}`,
      },
    },
    onUpdate: ({ editor }) => onChange(richTextOutput(editor, outputFormat)),
  }, [extensions]);

  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor) return;
    const content = richTextInput(value, inputFormat);
    const parsed = createDocument(content, editor.schema);
    // Parse HTML before comparing so normalized markup does not reset the selection.
    if (!editor.state.doc.eq(parsed)) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [editor, value, inputFormat]);

  if (!editor) return <div aria-label="富文本加载中" className={`min-h-32 animate-pulse rounded-md border border-[var(--color-border)] ${className}`} />;

  return (
    <div className={`flex h-full min-h-32 w-full flex-col overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] ${className}`}>
      {showToolbar && (editable || preview) ? <RichTextToolbar disabled={!editable} editor={editor} /> : null}
      <EditorContent className="min-h-0 flex-1 overflow-auto" editor={editor} />
    </div>
  );
}
