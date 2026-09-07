"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-3 mt-6 text-2xl font-semibold leading-tight first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-5 text-xl font-semibold leading-tight first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>,
  li: ({ children }) => <li className="pl-1 marker:text-[var(--color-primary)]">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-[var(--color-border)] pl-4 text-[var(--color-text-secondary)]">{children}</blockquote>,
  a: ({ children, href }) => <a className="font-medium text-[var(--color-primary)] underline decoration-current/30 underline-offset-4 hover:decoration-current" href={href} target="_blank" rel="noreferrer">{children}</a>,
  hr: () => <hr className="my-5 border-[var(--color-border)]" />,
  table: ({ children }) => <table className="my-4 block w-full overflow-x-auto border-collapse text-left text-sm">{children}</table>,
  thead: ({ children }) => <thead className="bg-[var(--color-control-soft)]">{children}</thead>,
  th: ({ children }) => <th className="whitespace-nowrap border border-[var(--color-border)] px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-[var(--color-border)] px-3 py-2 align-top">{children}</td>,
  pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-xl bg-[var(--color-bg-subtle)] p-4 text-[13px] leading-6">{children}</pre>,
  code: ({ children, className }) => {
    const isBlock = Boolean(className) || String(children).includes("\n");
    return <code className={isBlock ? className : "rounded bg-[var(--color-control-soft)] px-1.5 py-0.5 font-mono text-[0.9em] text-[var(--color-primary)]"}>{children}</code>;
  },
};

const compactMarkdownComponents: Components = {
  ...markdownComponents,
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-sm font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-xs font-semibold first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
  table: ({ children }) => <table className="my-2 block w-full overflow-x-auto border-collapse text-left text-xs">{children}</table>,
  th: ({ children }) => <th className="whitespace-nowrap border border-[var(--color-border)] px-2 py-1.5 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-[var(--color-border)] px-2 py-1.5 align-top">{children}</td>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-lg bg-[var(--color-bg-subtle)] p-3 text-[11px] leading-5">{children}</pre>,
};

export const AgentMarkdown = memo(function AgentMarkdown({ content, compact = false }: { content: string; compact?: boolean }) {
  const normalized = normalizeAgentMarkdown(content);
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={compact ? compactMarkdownComponents : markdownComponents}>{normalized}</ReactMarkdown>;
});

/**
 * Normalize provider text before handing it to remark-gfm. DSH keeps
 * reasoning/tool blocks outside the text block; model providers can still
 * return a table with row separators collapsed into `||` or with a heading
 * marker glued to its text. Those are transport defects, not meaningful
 * Markdown, and otherwise render as one giant paragraph.
 */
export function normalizeAgentMarkdown(value: string): string {
  let text = cleanAgentText(value)
    .replace(/^(\s{0,3}#{1,6})(?=\S)/gm, "$1 ")
    .replace(/^\s*\\(#{1,6})\s+/gm, "$1 ")
    .replace(/^\s*#{2,6}\s+(?=#{1,6}\s+)/gm, "")
    .replace(/\r\n?/g, "\n");
  // An unmatched emphasis marker is common when a streamed block is cut at
  // a tool boundary (for example `**字段设计方案：表单）。`). Leaving it in
  // place makes the rest of the response look like raw Markdown syntax.
  if ((text.match(/\*\*/g)?.length ?? 0) % 2 === 1) text = text.replace(/\*\*/g, "");
  // Streaming providers occasionally append the same parenthesized fragment
  // or slash-delimited status twice at a chunk boundary.
  text = text
    .replace(/(（[^\n（）]{1,80}）)\1/g, "$1")
    .replace(/(\([^\n()]{1,80}\))\1/g, "$1")
    .replace(/\/([^/\s]{1,24})\/\1\b/g, "/$1");
  const lines = text.split("\n");
  const normalized: string[] = [];
  let previousComparable = "";
  const recentListItems: string[] = [];
  for (const sourceLine of lines) {
    const line = sourceLine.trimEnd();
    const comparable = line.replace(/\s+/g, " ").trim();
    // Do not render an adjacent duplicate heading/list item as two separate
    // blocks. This is a common replay artifact when an assistant/message is
    // reconstructed after a tool step.
    if (comparable && comparable === previousComparable && (/^#{1,6}\s/.test(comparable) || /^[-*+]\s/.test(comparable) || /^\d+[.)]\s/.test(comparable))) continue;
    const listText = comparable.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "").replace(/[：:，,。；;]+$/g, "");
    if ((/^[-*+]\s+/.test(comparable) || /^\d+[.)]\s+/.test(comparable)) && listText.length >= 4) {
      const duplicate = recentListItems.some((item) => item === listText || (item.length >= 10 && listText.startsWith(item)) || (listText.length >= 10 && item.startsWith(listText)));
      if (duplicate) continue;
      recentListItems.push(listText);
      if (recentListItems.length > 12) recentListItems.shift();
    }
    if (comparable) previousComparable = comparable;
    // A GFM table must have one physical row per line. Some compatible
    // providers encode the row boundary as `||`; restore it only on lines
    // that are clearly table-shaped to avoid changing prose such as `A || B`.
    if ((line.match(/\|/g)?.length ?? 0) >= 6 && line.includes("||")) {
      const rows = line.split(/\|\s*\|/g);
      if (rows.length > 1) {
        normalized.push(rows.map((row, index) => `${index > 0 ? "|" : ""}${row.trim()}${index < rows.length - 1 ? "|" : ""}`).join("\n"));
        continue;
      }
    }
    normalized.push(line);
  }
  return normalized.join("\n");
}

/** Remove duplicated stream/model fragments while preserving intentional prose. */
export function cleanAgentText(value: string): string {
  let text = value;
  // English/tool traces: "listed listed apps apps" -> "listed apps".
  text = text.replace(/\b([A-Za-z][A-Za-z0-9_-]{1,40})(\s+\1\b)+/gi, "$1");
  // CJK fragments occasionally arrive twice from provider reasoning deltas.
  text = text.replace(/([\u4e00-\u9fff]{2,12})\1(?=[\u4e00-\u9fff，。！？、：；（）《》“”‘’\s]|$)/g, "$1");
  // Repeated punctuation/closing markdown markers are never meaningful here.
  text = text.replace(/([。！？：；，、])\1+/g, "$1");
  // DeepSeek-compatible gateways may replay an overlapping text chunk. Keep
  // the first copy when a short CJK/Latin phrase is repeated adjacently, e.g.
  // "我能做的 我能做的" or "【类页面】【类页面】".
  for (let pass = 0; pass < 3; pass += 1) {
    text = text
      .replace(/([\u4e00-\u9fffA-Za-z0-9【】「」\[\]（）()、：:，,。！？!? ]{2,32})\s+\1/g, "$1")
      .replace(/([\u4e00-\u9fffA-Za-z0-9【】「」\[\]（）()、：:，,。！？!? ]{4,48})([，,。；;：:]\s*)\1/g, "$1$2")
      .replace(/([【「\[][^{\n}]{1,40}[】」\]])\1/g, "$1");
  }
  return text;
}
