"use client";

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

export function AgentMarkdown({ content, compact = false }: { content: string; compact?: boolean }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={compact ? compactMarkdownComponents : markdownComponents}>{content}</ReactMarkdown>;
}
