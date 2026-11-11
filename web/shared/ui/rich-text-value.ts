import type { Editor } from "@tiptap/core";

export type RichTextDocument = { type: "doc"; content: Array<Record<string, unknown>> };
export const EMPTY_RICH_TEXT_DOCUMENT: RichTextDocument = { type: "doc", content: [] };
export type RichTextContent = { json: RichTextDocument; html: string; text: string };
export type RichTextOutputMap = { json: RichTextDocument; html: string; text: string; all: RichTextContent };
export type RichTextOutputFormat = keyof RichTextOutputMap;

/** Plain text is always inserted literally, including strings resembling HTML. */
export function richTextInput(value: RichTextDocument | string | null, format: "json" | "html" | "text") {
  if (value === null || value === "") return EMPTY_RICH_TEXT_DOCUMENT;
  if (typeof value !== "string") return value;
  if (format === "html") return value;
  return {
    type: "doc",
    content: value.split(/\r?\n/).map(text => ({
      type: "paragraph", content: text ? [{ type: "text", text }] : [],
    })),
  };
}

export function richTextOutput<F extends RichTextOutputFormat = "json">(editor: Editor, format?: F): RichTextOutputMap[F] {
  const output = format ?? "json";
  if (output === "html") return editor.getHTML() as RichTextOutputMap[F];
  if (output === "text") return editor.getText() as RichTextOutputMap[F];
  const json = editor.getJSON() as RichTextDocument;
  if (output === "all") return { json, html: editor.getHTML(), text: editor.getText() } as RichTextOutputMap[F];
  return json as RichTextOutputMap[F];
}

export function isRichTextUrl(value: string): boolean {
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}
