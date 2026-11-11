import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "./RichTextEditor";
import { createRichTextExtensions } from "./rich-text-extensions";
import { richTextInput, richTextOutput } from "./rich-text-value";

afterEach(cleanup);

describe("shared rich text content contract", () => {
  it("round-trips document formatting and exports mail HTML and text from the same schema", () => {
    const editor = new Editor({ extensions: createRichTextExtensions(), content: '<p><strong>你好</strong></p><table><tbody><tr><td><p>表格</p></td></tr></tbody></table><img src="https://example.com/a.png"><p>结尾</p>' });
    try {
      const output = richTextOutput(editor, "all");
      expect(output.json.type).toBe("doc");
      expect(output.html).toContain("<strong>你好</strong>");
      expect(output.html).toContain("<table");
      expect(output.html).toContain('src="https://example.com/a.png"');
      expect(output.text).toContain("表格");
      editor.commands.setContent(output.json);
      expect(richTextOutput(editor)).toEqual(output.json);
      expect(richTextOutput(editor, "html")).toEqual(output.html);
      expect(richTextOutput(editor, "text")).toEqual(output.text);
      expect(new Set(editor.extensionManager.extensions.map(extension => extension.name)).size).toBe(editor.extensionManager.extensions.length);
    } finally { editor.destroy(); }
  });

  it("treats text input as literal text and preserves line breaks", () => {
    const editor = new Editor({ extensions: createRichTextExtensions(), content: richTextInput('<img src=x>\n第二行', "text") });
    try {
      expect(editor.getHTML()).toContain("&lt;img src=x&gt;");
      expect(editor.getJSON().content).toHaveLength(2);
      expect(editor.getText()).toContain("第二行");
    } finally { editor.destroy(); }
  });
});

describe("controlled editor", () => {
  it("shares the complete toolbar and updates mark state on selection changes", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<RichTextEditor ariaLabel="编辑内容" inputFormat="html" value="<p><strong>粗体</strong>正文</p>" onChange={onChange} />);
    const element = await screen.findByRole("textbox", { name: "编辑内容" });
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    expect(screen.getByRole("toolbar", { name: "富文本格式工具栏" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "插入表格" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "插入图片地址" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "代码块" })).toBeTruthy();
    act(() => editor.commands.setTextSelection(2));
    expect(screen.getByRole("button", { name: "加粗" }).getAttribute("aria-pressed")).toBe("true");
    act(() => editor.commands.setTextSelection(4));
    expect(screen.getByRole("button", { name: "加粗" }).getAttribute("aria-pressed")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();
    rerender(<RichTextEditor ariaLabel="编辑内容" inputFormat="html" value="<p><strong>粗体</strong>正文</p>" onChange={onChange} readOnly />);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("updates external HTML and clears it without emitting changes", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<RichTextEditor ariaLabel="正文" inputFormat="html" outputFormat="all" value="<p>原始</p>" onChange={onChange} showToolbar={false} />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "正文" }).textContent).toBe("原始"));
    rerender(<RichTextEditor ariaLabel="正文" inputFormat="html" outputFormat="all" value="<p>更新</p>" onChange={onChange} showToolbar={false} />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "正文" }).textContent).toBe("更新"));
    rerender(<RichTextEditor ariaLabel="正文" inputFormat="html" outputFormat="all" value="" onChange={onChange} showToolbar={false} />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "正文" }).textContent).toBe(""));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("emits the selected format for user edits and respects read-only changes", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<RichTextEditor ariaLabel="表单正文" value={null} onChange={onChange} showToolbar={false} />);
    const element = await screen.findByRole("textbox", { name: "表单正文" });
    // Use the real ProseMirror view to simulate a committed input transaction.
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    act(() => editor.commands.insertContent("输入内容"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: "doc" }));
    rerender(<RichTextEditor ariaLabel="表单正文" value={onChange.mock.calls[0][0]} onChange={onChange} readOnly showToolbar={false} />);
    await waitFor(() => expect(element.getAttribute("contenteditable")).toBe("false"));
  });

  it("keeps selection during HTML feedback and uses the latest output callback", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<RichTextEditor ariaLabel="邮件正文" inputFormat="html" outputFormat="all" value="<p>邮件</p>" onChange={first} showToolbar={false} />);
    const element = await screen.findByRole("textbox", { name: "邮件正文" });
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    act(() => editor.commands.insertContent("新"));
    const output = first.mock.calls[0][0];
    expect(output.text).toContain("新");
    expect(output.html).toContain("新");
    const position = editor.state.selection.from;
    rerender(<RichTextEditor ariaLabel="邮件正文" inputFormat="html" outputFormat="text" value={output.html} onChange={second} showToolbar={false} />);
    expect(editor.state.selection.from).toBe(position);
    act(() => editor.commands.insertContent("内容"));
    expect(second).toHaveBeenCalledWith(expect.stringContaining("内容"));
    expect(first).toHaveBeenCalledTimes(1);
  });
});
