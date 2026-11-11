"use client";

import { memo, useState } from "react";
import { KnowledgeCitationModal } from "@/features/knowledge/KnowledgeSources";
import { MarkdownRenderer } from "@/shared/ui/MarkdownRenderer";

/** Agent 专属内容修复留在业务层，公共 Markdown 组件只负责展示。 */
export const AgentMarkdown = memo(function AgentMarkdown({
  content,
  compact = false,
  citationIds = [],
}: {
  content: string;
  compact?: boolean;
  citationIds?: string[];
}) {
  const [citation, setCitation] = useState<string>();
  const rendered = normalizeAgentMarkdown(content).replace(/\[([^\]]+)\]\(knowledge:\/\/citation\/([0-9a-f-]{36})\)/gi, (_match, label: string, id: string) => citationIds.includes(id) ? `[${label}](#knowledge-citation-${id})` : label);
  return (
    <div onClick={(event) => {
      const anchor = (event.target as HTMLElement).closest("a");
      const match = anchor?.getAttribute("href")?.match(/^#knowledge-citation-([0-9a-f-]{36})$/i);
      if (match) { event.preventDefault(); if (citationIds.includes(match[1])) setCitation(match[1]); }
    }}>
      <MarkdownRenderer content={rendered} compact={compact} />
      {citation && <KnowledgeCitationModal key={citation} citationId={citation} onClose={() => setCitation(undefined)} />}
    </div>
  );
});

/**
 * Normalize provider text before handing it to remark-gfm. The runtime keeps
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
  if ((text.match(/\*\*/g)?.length ?? 0) % 2 === 1)
    text = text.replace(/\*\*/g, "");
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
    if (
      comparable &&
      comparable === previousComparable &&
      (/^#{1,6}\s/.test(comparable) ||
        /^[-*+]\s/.test(comparable) ||
        /^\d+[.)]\s/.test(comparable))
    )
      continue;
    const listText = comparable
      .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/[：:，,。；;]+$/g, "");
    if (
      (/^[-*+]\s+/.test(comparable) || /^\d+[.)]\s+/.test(comparable)) &&
      listText.length >= 4
    ) {
      const duplicate = recentListItems.some(
        (item) =>
          item === listText ||
          (item.length >= 10 && listText.startsWith(item)) ||
          (listText.length >= 10 && item.startsWith(listText)),
      );
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
        normalized.push(
          rows
            .map(
              (row, index) =>
                `${index > 0 ? "|" : ""}${row.trim()}${index < rows.length - 1 ? "|" : ""}`,
            )
            .join("\n"),
        );
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
  text = text.replace(
    /([\u4e00-\u9fff]{2,12})\1(?=[\u4e00-\u9fff，。！？、：；（）《》“”‘’\s]|$)/g,
    "$1",
  );
  // Repeated punctuation/closing markdown markers are never meaningful here.
  text = text.replace(/([。！？：；，、])\1+/g, "$1");
  // DeepSeek-compatible gateways may replay an overlapping text chunk. Keep
  // the first copy when a short CJK/Latin phrase is repeated adjacently, e.g.
  // "我能做的 我能做的" or "【类页面】【类页面】".
  for (let pass = 0; pass < 3; pass += 1) {
    text = text
      .replace(
        /([\u4e00-\u9fffA-Za-z0-9【】「」\[\]（）()、：:，,。！？!? ]{2,32})\s+\1/g,
        "$1",
      )
      .replace(
        /([\u4e00-\u9fffA-Za-z0-9【】「」\[\]（）()、：:，,。！？!? ]{4,48})([，,。；;：:]\s*)\1/g,
        "$1$2",
      )
      .replace(/([【「\[][^{\n}]{1,40}[】」\]])\1/g, "$1");
  }
  return text;
}
