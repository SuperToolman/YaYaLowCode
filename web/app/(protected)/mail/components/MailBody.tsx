"use client";

import { useEffect, useMemo } from "react";
import { notify } from "@lib/notify";
import { mailHtmlDocument } from "@features/mail/html-body";

function report(description: string) {
  notify.error("邮件内容渲染异常", { description });
}
export function MailBody({ html, text, inlineImages }: { html?: string | null; text: string; inlineImages?: Record<string, string> }) {
  const result = useMemo(() => {
    if (!html) return { source: "", error: "" };
    try { return { source: mailHtmlDocument(html, inlineImages), error: "" }; }
    catch (cause) { return { source: "", error: cause instanceof Error ? cause.message : "HTML 正文处理失败" }; }
  }, [html, inlineImages]);
  useEffect(() => { if (result.error) report(result.error); }, [result.error]);
  return <section className="flex min-h-[800px] min-w-0 flex-1 shrink-0 flex-col overflow-hidden" aria-label="邮件正文">
    {result.source ? <iframe title="邮件 HTML 正文" srcDoc={result.source} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" className="h-0 min-h-[800px] w-full flex-1 rounded-lg border border-[var(--color-border)] bg-white"
      onError={() => report("邮件正文容器加载失败")}
      onLoad={event => {
        // Scripts remain disabled; same-origin access is only used to inspect image failures.
        const document = event.currentTarget.contentDocument;
        if (!document) { report("无法读取邮件正文的渲染状态"); return; }
        const failed = Array.from(document.images).filter(image => image.getAttribute("src") && image.complete && image.naturalWidth === 0);
        if (failed.length) report(`${failed.length} 张邮件图片加载失败，请检查图片地址、网络连接或浏览器拦截`);
      }} /> : !html ? <div className="min-h-0 flex-1 overflow-auto overscroll-contain whitespace-pre-wrap break-words">{text || "暂无可显示的正文"}</div> : null}
  </section>;
}
