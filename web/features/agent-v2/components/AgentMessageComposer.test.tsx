import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { AgentMessageComposer } from "./AgentMessageComposer";
import type { DraftAttachment } from "./AgentDraftEditor";

const created = vi.fn(() => "blob:preview");
const revoked = vi.fn();
beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: created });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoked });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function Composer({ frozen = false, onSend = vi.fn() }: { frozen?: boolean; onSend?: () => void }) {
  const [value, setValue] = useState("请整理");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  return <AgentMessageComposer value={value} attachments={attachments} frozen={frozen} onChange={setValue}
    onUpload={files => setAttachments(items => [...items, ...files.map(file => ({ id: file.name, name: file.name, size: file.size, file }))])}
    onRemoveAttachment={id => setAttachments(items => items.filter(file => file.id !== id))}
    onSend={onSend} onCancel={() => {}} />;
}

it("inserts pasted images inside the editable draft and releases their previews when removed", async () => {
  render(<Composer />);
  const editor = await screen.findByRole("textbox", { name: "发送给 AI 员工" });
  const image = new File(["image"], "图片.png", { type: "image/png" });
  fireEvent.paste(editor, { clipboardData: { files: [image], getData: () => "" } });
  const preview = await screen.findByAltText("图片.png");
  expect(editor.contains(preview)).toBe(true);
  expect(preview.closest('[draggable="true"]')).toBeTruthy();
  expect(editor.textContent).toContain("请整理");
  fireEvent.click(screen.getByRole("button", { name: "移除附件 图片.png" }));
  await waitFor(() => expect(screen.queryByAltText("图片.png")).toBeNull());
  expect(revoked).toHaveBeenCalledWith("blob:preview");
});

it("accepts file drops and clears the drag indicator after nested enters", async () => {
  render(<Composer />);
  const editor = await screen.findByRole("textbox");
  const form = editor.closest("form")!;
  const dataTransfer = { types: ["Files"], files: [new File(["bom"], "BOM.xlsx")], dropEffect: "none" };
  fireEvent.dragEnter(form, { dataTransfer });
  fireEvent.dragEnter(editor, { dataTransfer });
  fireEvent.dragLeave(editor, { dataTransfer });
  expect(screen.getByText("松开以添加图片或文件")).toBeTruthy();
  fireEvent.drop(form, { dataTransfer, clientX: 0, clientY: 0 });
  await screen.findByRole("button", { name: "移除附件 BOM.xlsx" });
  expect(editor.textContent).toContain("BOM.xlsx");
  expect(screen.queryByText("松开以添加图片或文件")).toBeNull();
});

it("sends on Enter, keeps Shift+Enter and IME composition in the editor, and blocks frozen sends", async () => {
  const onSend = vi.fn();
  const view = render(<Composer onSend={onSend} />);
  const editor = await screen.findByRole("textbox");
  fireEvent.keyDown(editor, { key: "Enter", isComposing: true });
  fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.keyDown(editor, { key: "Enter" });
  expect(onSend).toHaveBeenCalledTimes(1);
  view.rerender(<Composer onSend={onSend} frozen />);
  fireEvent.submit(editor.closest("form")!);
  expect(onSend).toHaveBeenCalledTimes(1);
});

it("clears inline attachments after send without revoking retained preview URLs on typing", async () => {
  const file = new File(["image"], "photo.png", { type: "image/png" });
  const props = { value: "draft", attachments: [{ id: "photo", name: file.name, size: file.size, file }], onChange: vi.fn(), onSend: vi.fn(), onCancel: vi.fn() };
  const view = render(<AgentMessageComposer {...props} />);
  await screen.findByAltText("photo.png");
  view.rerender(<AgentMessageComposer {...props} value="changed" />);
  await waitFor(() => expect(screen.getByRole("textbox").textContent).toContain("changed"));
  expect(revoked).not.toHaveBeenCalled();
  view.rerender(<AgentMessageComposer {...props} value="" attachments={[]} />);
  await waitFor(() => expect(screen.queryByAltText("photo.png")).toBeNull());
  expect(screen.getByRole("textbox").textContent).toBe("");
  expect(revoked).toHaveBeenCalledWith("blob:preview");
});

it("keeps pasted text plain, enforces the existing text limit and synchronizes keyboard attachment deletion", async () => {
  render(<Composer />);
  const editor = await screen.findByRole("textbox") as HTMLDivElement & { editor: Editor };
  fireEvent.paste(editor, { clipboardData: { files: [], getData: () => "<script>plain text</script>" } });
  await waitFor(() => expect(editor.textContent).toContain("<script>plain text</script>"));
  expect(editor.querySelector("script")).toBeNull();
  const before = editor.textContent;
  fireEvent.paste(editor, { clipboardData: { files: [], getData: () => "x".repeat(16001) } });
  expect(editor.textContent).toBe(before);
  fireEvent.paste(editor, { clipboardData: { files: [new File(["bom"], "delete.xlsx")], getData: () => "" } });
  await screen.findByRole("button", { name: "移除附件 delete.xlsx" });
  let attachmentPosition = 0;
  editor.editor.state.doc.descendants((node, pos) => { if (node.type.name === "agentAttachment") attachmentPosition = pos; });
  act(() => { editor.editor.commands.setNodeSelection(attachmentPosition); });
  fireEvent.keyDown(editor, { key: "Backspace" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "移除附件 delete.xlsx" })).toBeNull());
  expect(editor.textContent).toBe(before);
});

it("rejects external drops while a submission is frozen", async () => {
  render(<Composer frozen />);
  const editor = await screen.findByRole("textbox");
  fireEvent.drop(editor, { dataTransfer: { types: ["Files"], files: [new File(["bom"], "blocked.xlsx")] } });
  expect(screen.queryByRole("button", { name: "移除附件 blocked.xlsx" })).toBeNull();
});
