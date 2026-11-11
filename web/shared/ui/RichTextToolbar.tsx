"use client";

import { useState } from "react";
import { Button, Input, Label, Popover, TextField } from "@heroui/react";
import { ArrowUturnCcwLeft, ArrowUturnCwRight, Bold, BroomMotion, Italic, LayoutHeaderColumns, Link as LinkIcon, ListCheck, ListOl, ListUl, Picture, Plus, QuoteClose, SquareLineHorizontal, Strikethrough, TextAlignCenter, TextAlignLeft, TextAlignRight, TrashBin, Underline as UnderlineIcon } from "@gravity-ui/icons";
import { useEditorState, type Editor } from "@tiptap/react";
import { isRichTextUrl } from "./rich-text-value";

const FONT_FAMILIES = ["默认", "Arial", "Microsoft YaHei", "SimSun", "monospace"];
const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "32px"];

export function RichTextToolbar({
  disabled,
  editor,
}: {
  disabled: boolean;
  editor: Editor;
}) {
  useEditorState({ editor, selector: ({ editor }) => editor.state });
  const execute = (action: () => void) => {
    if (!disabled) action();
  };

  return (
    <div role="toolbar" aria-label="富文本格式工具栏" className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-2 py-1">
      <ToolbarButton
        disabled={disabled}
        label="撤销"
        onClick={() => execute(() => editor.chain().focus().undo().run())}
      >
        <ArrowUturnCcwLeft />
      </ToolbarButton>
      <ToolbarButton
        disabled={disabled}
        label="重做"
        onClick={() => execute(() => editor.chain().focus().redo().run())}
      >
        <ArrowUturnCwRight />
      </ToolbarButton>
      <ToolbarButton
        disabled={disabled}
        label="清除格式"
        onClick={() =>
          execute(() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run(),
          )
        }
      >
        <BroomMotion />
      </ToolbarButton>
      <ToolbarSelect
        disabled={disabled}
        label="段落样式"
        value={
          editor.isActive("heading", { level: 1 })
            ? "h1"
            : editor.isActive("heading", { level: 2 })
              ? "h2"
              : editor.isActive("heading", { level: 3 })
                ? "h3"
                : "p"
        }
        onChange={(value) =>
          execute(() =>
            value === "p"
              ? editor.chain().focus().setParagraph().run()
              : editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 })
                  .run(),
          )
        }
        options={[
          { value: "p", label: "正文" },
          { value: "h1", label: "标题 1" },
          { value: "h2", label: "标题 2" },
          { value: "h3", label: "标题 3" },
        ]}
      />
      <ToolbarSelect
        disabled={disabled}
        label="字体"
        value={
          (editor.getAttributes("textStyle").fontFamily as
            | string
            | undefined) ?? "默认"
        }
        onChange={(value) =>
          execute(() =>
            value === "默认"
              ? editor.chain().focus().unsetFontFamily().run()
              : editor.chain().focus().setFontFamily(value).run(),
          )
        }
        options={FONT_FAMILIES.map((value) => ({ value, label: value }))}
      />
      <ToolbarSelect
        disabled={disabled}
        label="字号"
        value={
          (editor.getAttributes("textStyle").fontSize as string | undefined) ??
          "14px"
        }
        onChange={(value) =>
          execute(() => editor.chain().focus().setFontSize(value).run())
        }
        options={FONT_SIZES.map((value) => ({
          value,
          label: value.replace("px", ""),
        }))}
      />
      <ToolbarButton
        active={editor.isActive("bold")}
        disabled={disabled}
        label="加粗"
        onClick={() => execute(() => editor.chain().focus().toggleBold().run())}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("italic")}
        disabled={disabled}
        label="斜体"
        onClick={() =>
          execute(() => editor.chain().focus().toggleItalic().run())
        }
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("strike")}
        disabled={disabled}
        label="删除线"
        onClick={() =>
          execute(() => editor.chain().focus().toggleStrike().run())
        }
      >
        <Strikethrough />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("underline")}
        disabled={disabled}
        label="下划线"
        onClick={() =>
          execute(() => editor.chain().focus().toggleUnderline().run())
        }
      >
        <UnderlineIcon />
      </ToolbarButton>
      <ColorInput
        disabled={disabled}
        label="文字颜色"
        value={
          (editor.getAttributes("textStyle").color as string | undefined) ??
          "#1f2937"
        }
        onChange={(value) =>
          execute(() => editor.chain().focus().setColor(value).run())
        }
      />
      <ColorInput
        disabled={disabled}
        label="背景颜色"
        value={
          (editor.getAttributes("textStyle").backgroundColor as
            | string
            | undefined) ?? "#ffffff"
        }
        onChange={(value) =>
          execute(() => editor.chain().focus().setBackgroundColor(value).run())
        }
      />
      <ToolbarButton
        active={editor.isActive("bulletList")}
        disabled={disabled}
        label="无序列表"
        onClick={() =>
          execute(() => editor.chain().focus().toggleBulletList().run())
        }
      >
        <ListUl />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("orderedList")}
        disabled={disabled}
        label="有序列表"
        onClick={() =>
          execute(() => editor.chain().focus().toggleOrderedList().run())
        }
      >
        <ListOl />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("taskList")}
        disabled={disabled}
        label="任务列表"
        onClick={() =>
          execute(() => editor.chain().focus().toggleTaskList().run())
        }
      >
        <ListCheck />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive({ textAlign: "left" })}
        disabled={disabled}
        label="左对齐"
        onClick={() =>
          execute(() => editor.chain().focus().setTextAlign("left").run())
        }
      >
        <TextAlignLeft />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive({ textAlign: "center" })}
        disabled={disabled}
        label="居中"
        onClick={() =>
          execute(() => editor.chain().focus().setTextAlign("center").run())
        }
      >
        <TextAlignCenter />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive({ textAlign: "right" })}
        disabled={disabled}
        label="右对齐"
        onClick={() =>
          execute(() => editor.chain().focus().setTextAlign("right").run())
        }
      >
        <TextAlignRight />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("blockquote")}
        disabled={disabled}
        label="引用"
        onClick={() =>
          execute(() => editor.chain().focus().toggleBlockquote().run())
        }
      >
        <QuoteClose />
      </ToolbarButton>
      <ToolbarButton
        disabled={disabled}
        label="分割线"
        onClick={() =>
          execute(() => editor.chain().focus().setHorizontalRule().run())
        }
      >
        <SquareLineHorizontal />
      </ToolbarButton>
      <UrlControl disabled={disabled} kind="link" editor={editor} />
      <UrlControl disabled={disabled} kind="image" editor={editor} />
      <ToolbarButton
        active={editor.isActive("table")}
        disabled={disabled}
        label="插入表格"
        onClick={() =>
          execute(() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run(),
          )
        }
      >
        <LayoutHeaderColumns />
      </ToolbarButton>
      <ToolbarButton disabled={disabled} active={editor.isActive("highlight")} label="高亮" onClick={() => execute(() => editor.chain().focus().toggleHighlight().run())}>高亮</ToolbarButton>
      <ToolbarButton disabled={disabled} active={editor.isActive("code")} label="行内代码" onClick={() => execute(() => editor.chain().focus().toggleCode().run())}>代码</ToolbarButton>
      <ToolbarButton disabled={disabled} active={editor.isActive("codeBlock")} label="代码块" onClick={() => execute(() => editor.chain().focus().toggleCodeBlock().run())}>代码块</ToolbarButton>
      <ToolbarSelect disabled={disabled} label="插入表情" value="" options={[{ value: "", label: "表情" }, ...["😊", "👍", "🎉", "🙏", "❤️"].map(value => ({ value, label: value }))]} onChange={value => execute(() => editor.chain().focus().insertContent({ type: "text", text: value }).run())} />
      {editor.isActive("table") ? (
        <>
          <ToolbarButton
            disabled={disabled}
            label="插入行"
            onClick={() =>
              execute(() => editor.chain().focus().addRowAfter().run())
            }
          >
            <Plus />
          </ToolbarButton>
          <ToolbarButton
            disabled={disabled}
            label="插入列"
            onClick={() =>
              execute(() => editor.chain().focus().addColumnAfter().run())
            }
          >
            <Plus />
          </ToolbarButton>
          <ToolbarButton disabled={disabled} label="删除行" onClick={() => execute(() => editor.chain().focus().deleteRow().run())}>删行</ToolbarButton>
          <ToolbarButton disabled={disabled} label="删除列" onClick={() => execute(() => editor.chain().focus().deleteColumn().run())}>删列</ToolbarButton>
          <ToolbarButton disabled={disabled} label="合并单元格" onClick={() => execute(() => editor.chain().focus().mergeCells().run())}>合并</ToolbarButton>
          <ToolbarButton disabled={disabled} label="拆分单元格" onClick={() => execute(() => editor.chain().focus().splitCell().run())}>拆分</ToolbarButton>
          <ToolbarButton disabled={disabled} label="切换表头" onClick={() => execute(() => editor.chain().focus().toggleHeaderRow().run())}>表头</ToolbarButton>
          <ToolbarButton
            disabled={disabled}
            label="删除表格"
            onClick={() =>
              execute(() => editor.chain().focus().deleteTable().run())
            }
          >
            <TrashBin />
          </ToolbarButton>
        </>
      ) : null}
    </div>
  );
}

function ToolbarButton({
  active = false,
  children,
  disabled,
  label,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={[
        "flex h-7 shrink-0 items-center justify-center rounded px-1.5 text-xs hover:bg-[var(--color-bg-hover)] disabled:cursor-default disabled:opacity-50",
        active
          ? "bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
          : "text-[var(--color-text-secondary)]",
      ].join(" ")}
      disabled={disabled}
      title={label}
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function UrlControl({ disabled, kind, editor }: { disabled: boolean; kind: "link" | "image"; editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const label = kind === "link" ? "链接" : "图片";
  const apply = () => {
    if (disabled) return;
    const url = value.trim();
    if (kind === "link" && !url) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else if (!isRichTextUrl(url)) { setError("请输入有效的 HTTP/HTTPS 地址"); return; }
    else if (kind === "link") editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    else editor.chain().focus().setImage({ src: url }).run();
    setOpen(false);
  };
  return <Popover isOpen={open} onOpenChange={next => {
    setOpen(next);
    if (next) { setValue(kind === "link" ? editor.getAttributes("link").href ?? "" : ""); setError(""); }
  }}>
    <Button size="sm" isIconOnly aria-label={kind === "image" ? "插入图片地址" : label} isDisabled={disabled}>
      {kind === "link" ? <LinkIcon /> : <Picture />}
    </Button>
    <Popover.Content><Popover.Dialog className="flex w-72 flex-col gap-2">
      <TextField isDisabled={disabled} isInvalid={Boolean(error)}>
        <Label>{label}地址</Label>
        <Input value={value} placeholder="https://" onChange={event => { setValue(event.target.value); setError(""); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); apply(); } }} />
      </TextField>
      {error ? <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p> : null}
      <Button isDisabled={disabled} onPress={apply}>{kind === "link" && !value.trim() ? "移除链接" : `插入${label}`}</Button>
    </Popover.Dialog></Popover.Content>
  </Popover>;
}

function ToolbarSelect({
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  value: string;
}) {
  return (
    <select
      aria-label={label}
      className="h-7 shrink-0 rounded border-0 bg-transparent px-1 text-xs text-[var(--color-text-secondary)] outline-none disabled:opacity-50"
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ColorInput({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label
      aria-label={label}
      className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center disabled:cursor-default"
    >
      <input
        aria-label={label}
        className="h-4 w-4 cursor-pointer bg-transparent p-0"
        disabled={disabled}
        type="color"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}
