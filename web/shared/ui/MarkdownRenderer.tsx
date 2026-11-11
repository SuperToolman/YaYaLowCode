"use client";

import { memo, useEffect, useState, type ComponentPropsWithoutRef } from "react";
import type { Element, Root, RootContent } from "hast";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypePrism from "rehype-prism-plus";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { notify } from "@/shared/lib/notify";
import styles from "./MarkdownRenderer.module.css";

export type MarkdownRendererProps = {
  content: string;
  compact?: boolean;
  className?: string;
  showHeadingAnchors?: boolean;
};

const remarkPlugins = [remarkGfm];
// Prism may normalize the last blank line. Capture source before highlighting.
const codeSources = new WeakMap<object, string>();
function nodeText(node: Root | RootContent): string {
  return node.type === "text" ? node.value : "children" in node ? node.children.map(nodeText).join("") : "";
}
function visitCodeBlocks(tree: Root | Element, callback: (node: Element) => void) {
  if (tree.type === "element" && tree.tagName === "pre") callback(tree);
  for (const child of tree.children) if (child.type === "element") visitCodeBlocks(child, callback);
}
function captureCodeSource() {
  return (tree: Root) => visitCodeBlocks(tree, node => codeSources.set(node, nodeText(node)));
}
function restoreCodeWhitespace() {
  return (tree: Root) => visitCodeBlocks(tree, node => {
    const source = codeSources.get(node);
    const code = node.children.find(child => child.type === "element" && child.tagName === "code");
    if (source === undefined || code?.type !== "element") return;
    const highlighted = nodeText(code);
    if (source.startsWith(highlighted) && source.length > highlighted.length) {
      code.children.push({ type: "text", value: source.slice(highlighted.length) });
    }
  });
}
const highlightPlugins: NonNullable<ComponentPropsWithoutRef<typeof ReactMarkdown>["rehypePlugins"]> = [
  captureCodeSource,
  [rehypePrism, { ignoreMissing: true }],
  restoreCodeWhitespace,
];
const anchorPlugins: typeof highlightPlugins = [
  ...highlightPlugins,
  rehypeSlug,
  [rehypeAutolinkHeadings, {
    behavior: "append",
    properties: { className: ["markdown-heading-anchor"], ariaLabel: "链接到此标题" },
    content: { type: "text", value: "#" },
  }],
];

function CodeBlock({ source, children, className, ...props }: ComponentPropsWithoutRef<"pre"> & { source: string }) {
  const [copiedSource, setCopiedSource] = useState<string | null>(null);
  const copied = copiedSource === source;
  useEffect(() => {
    if (copiedSource === null) return;
    const timer = window.setTimeout(() => setCopiedSource(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedSource]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopiedSource(source);
    } catch {
      notify.error("代码复制失败", { description: "请重试或手动选择代码复制。" });
    }
  };

  return <div className={styles["markdown-renderer__code-block"]}>
    <div className={styles["markdown-renderer__code-toolbar"]}>
      <button type="button" onClick={() => void copy()} aria-label="复制代码" className={styles["markdown-renderer__copy"]}>
        <span role="status" aria-live="polite">{copied ? "已复制" : "复制代码"}</span>
      </button>
    </div>
    <pre {...props} className={className}>{children}</pre>
  </div>;
}

const components: Components = {
  pre: ({ node, ...props }) => <CodeBlock {...props} source={node ? codeSources.get(node) ?? "" : ""} />,
  a: ({ href, children, className, id, title, ...props }) => (
    <a aria-label={props["aria-label"]} className={className} id={id} title={title} href={href} {...(href?.startsWith("#") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>{children}</a>
  ),
};

/**
 * 公共 Markdown 展示组件，支持 GFM、代码高亮与代码复制，默认不解析原始 HTML。
 * content 按原文渲染，不执行去重或内容修复；Agent 等业务应在调用前单独处理内容。
 * compact 使用紧凑排版，className 设置外层样式；showHeadingAnchors 开启标题锚点（默认关闭）。
 * 未知代码语言按普通代码展示；主题跟随项目 CSS 变量，无需传递明暗主题参数。
 *
 * @example 普通文档 / 更新日志
 * ```tsx
 * <MarkdownRenderer content={markdown} showHeadingAnchors />
 * ```
 * @example 紧凑消息
 * ```tsx
 * <MarkdownRenderer content={message} compact />
 * ```
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content, compact = false, className = "", showHeadingAnchors = false,
}: MarkdownRendererProps) {
  return <div className={`${styles["markdown-renderer__content"]} ${className}`} data-compact={compact || undefined}>
    <ReactMarkdown skipHtml remarkPlugins={remarkPlugins} rehypePlugins={showHeadingAnchors ? anchorPlugins : highlightPlugins} components={components}>
      {content}
    </ReactMarkdown>
  </div>;
});
