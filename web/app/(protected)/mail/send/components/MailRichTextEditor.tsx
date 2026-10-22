"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import {
  Button,
  Dropdown,
  Input,
  Label,
  Popover,
  Spinner,
  TextField,
  ToggleButton,
} from "@heroui/react";
import {
  ArrowUturnCcwLeft,
  ArrowUturnCwRight,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  ListUl,
  ListOl,
  QuoteClose,
  TextAlignLeft,
  TextAlignCenter,
  TextAlignRight,
  Link as LinkIcon,
  Picture,
  LayoutHeaderColumns,
} from "@gravity-ui/icons";
import { notify } from "@lib/notify";

export type MailBodyValue = { html: string; text: string };
export type MailEditorHandle = { reset: () => void };

export const MailRichTextEditor = forwardRef<
  MailEditorHandle,
  { disabled: boolean; onChange: (value: MailBodyValue) => void }
>(function MailRichTextEditor({ disabled, onChange }, ref) {
  const [link, setLink] = useState("");
  const [image, setImage] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Image.configure({ allowBase64: false }),
      TextAlign.configure({ types: ["paragraph", "heading"] }),
      TextStyle,
      FontSize,
      FontFamily,
      Color,
      Table,
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "正文",
        "aria-multiline": "true",
        class:
          "min-h-80 p-3 outline-none text-sm leading-7 break-words [&_p]:min-h-7 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-separator [&_blockquote]:pl-3 [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_img]:max-w-full [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-separator [&_td]:p-2 [&_th]:border [&_th]:border-separator [&_th]:p-2",
      },
    },
    onUpdate: ({ editor }) =>
      onChange({ html: editor.getHTML(), text: editor.getText() }),
  });
  useEditorState({ editor, selector: (context) => context.editor?.state });
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);
  useImperativeHandle(
    ref,
    () => ({ reset: () => editor?.commands.clearContent() }),
    [editor],
  );
  if (!editor)
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Spinner aria-label="加载富文本编辑器" />
      </div>
    );
  const toggles = [
    {
      label: "加粗",
      icon: Bold,
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      icon: Italic,
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "下划线",
      icon: Underline,
      active: editor.isActive("underline"),
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: "删除线",
      icon: Strikethrough,
      active: editor.isActive("strike"),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: "无序列表",
      icon: ListUl,
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "有序列表",
      icon: ListOl,
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "引用",
      icon: QuoteClose,
      active: editor.isActive("blockquote"),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
  ];
  function validUrl(url: string) {
    try {
      return ["http:", "https:"].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        aria-label="正文格式工具栏"
        className="flex shrink-0 flex-wrap items-center gap-1 border-y border-separator py-2"
      >
        <Button
          size="sm"
          isIconOnly
          aria-label="撤销"
          isDisabled={disabled || !editor.can().undo()}
          onPress={() => editor.chain().focus().undo().run()}
        >
          <ArrowUturnCcwLeft />
        </Button>
        <Button
          size="sm"
          isIconOnly
          aria-label="重做"
          isDisabled={disabled || !editor.can().redo()}
          onPress={() => editor.chain().focus().redo().run()}
        >
          <ArrowUturnCwRight />
        </Button>
        <Dropdown>
          <Button size="sm" isDisabled={disabled}>
            字体
          </Button>
          <Dropdown.Popover>
            <Dropdown.Menu
              aria-label="字体"
              onAction={(key) => {
                if (!disabled)
                  editor.chain().focus().setFontFamily(String(key)).run();
              }}
            >
              {["Arial", "Microsoft YaHei", "SimSun", "monospace"].map(
                (font) => (
                  <Dropdown.Item key={font} id={font}>
                    {font}
                  </Dropdown.Item>
                ),
              )}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        <Dropdown>
          <Button size="sm" isDisabled={disabled}>
            字号
          </Button>
          <Dropdown.Popover>
            <Dropdown.Menu
              aria-label="字号"
              onAction={(key) => {
                if (!disabled)
                  editor.chain().focus().setFontSize(String(key)).run();
              }}
            >
              {["12px", "14px", "16px", "18px", "24px", "32px"].map((size) => (
                <Dropdown.Item key={size} id={size}>
                  {size}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        {toggles.map(({ label, icon: Icon, active, run }) => (
          <ToggleButton
            key={label}
            size="sm"
            isIconOnly
            aria-label={label}
            isSelected={active}
            isDisabled={disabled}
            onChange={run}
          >
            <Icon />
          </ToggleButton>
        ))}
        {(
          [
            ["left", "左对齐", TextAlignLeft],
            ["center", "居中", TextAlignCenter],
            ["right", "右对齐", TextAlignRight],
          ] as const
        ).map(([align, label, Icon]) => (
          <ToggleButton
            key={align}
            size="sm"
            isIconOnly
            aria-label={label}
            isSelected={editor.isActive({ textAlign: align })}
            isDisabled={disabled}
            onChange={() => editor.chain().focus().setTextAlign(align).run()}
          >
            <Icon />
          </ToggleButton>
        ))}
        <Input
          type="color"
          aria-label="文字颜色"
          className="w-10"
          disabled={disabled}
          value={editor.getAttributes("textStyle").color || "#000000"}
          onChange={(event) =>
            editor.chain().focus().setColor(event.target.value).run()
          }
        />
        <Popover isOpen={linkOpen} onOpenChange={setLinkOpen}>
          <Button
            size="sm"
            isDisabled={disabled}
            onPress={() => setLinkOpen(true)}
          >
            <LinkIcon />
            链接
          </Button>
          <Popover.Content>
            <Popover.Dialog className="flex w-72 flex-col gap-2">
              <TextField isDisabled={disabled}>
                <Label>链接地址</Label>
                <Input
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                  placeholder="https://"
                />
              </TextField>
              <Button
                isDisabled={disabled}
                onPress={() => {
                  if (!validUrl(link))
                    return notify.error("请输入有效的 HTTP/HTTPS 链接");
                  editor.chain().focus().setLink({ href: link }).run();
                  setLinkOpen(false);
                }}
              >
                插入链接
              </Button>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
        <Popover isOpen={imageOpen} onOpenChange={setImageOpen}>
          <Button
            size="sm"
            isDisabled={disabled}
            onPress={() => setImageOpen(true)}
          >
            <Picture />
            图片
          </Button>
          <Popover.Content>
            <Popover.Dialog className="flex w-72 flex-col gap-2">
              <TextField isDisabled={disabled}>
                <Label>图片地址</Label>
                <Input
                  value={image}
                  onChange={(event) => setImage(event.target.value)}
                  placeholder="https://"
                />
              </TextField>
              <Button
                isDisabled={disabled}
                onPress={() => {
                  if (!validUrl(image))
                    return notify.error("请输入有效的 HTTP/HTTPS 图片地址");
                  editor.chain().focus().setImage({ src: image }).run();
                  setImageOpen(false);
                }}
              >
                插入图片
              </Button>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
        <Button
          size="sm"
          isDisabled={disabled}
          onPress={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          <LayoutHeaderColumns />
          表格
        </Button>
        <Dropdown>
          <Button size="sm" isDisabled={disabled}>
            表情
          </Button>
          <Dropdown.Popover>
            <Dropdown.Menu
              aria-label="插入表情"
              onAction={(key) => {
                if (!disabled)
                  editor.chain().focus().insertContent(String(key)).run();
              }}
            >
              {["😊", "👍", "🎉", "🙏", "❤️"].map((emoji) => (
                <Dropdown.Item key={emoji} id={emoji}>
                  {emoji}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        <Button
          size="sm"
          isDisabled={disabled}
          onPress={() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          }
        >
          清除格式
        </Button>
      </div>
      <EditorContent
        editor={editor}
        className="min-h-0 flex-1 overflow-auto overscroll-contain"
      />
    </div>
  );
});
