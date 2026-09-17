"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DefinedComponentType = "html" | "tsx";

type DefinedPageAsset = {
  id: string;
  name: string;
  type: "script" | "style";
  url: string;
  integrity?: string;
  enabled: boolean;
};

type RuntimeDefinedComponentProps = {
  type: DefinedComponentType;
  code?: string;
  allowedResourceOrigins?: string[];
  allowedFieldIds: string[];
  assets?: DefinedPageAsset[];
  values: Record<string, unknown>;
  isReadOnly?: boolean;
  onSetFieldValue: (fieldId: string, value: unknown) => void;
};

const MESSAGE_PREFIX = "yaya-defined-component";

export function RuntimeDefinedComponent({
  type,
  code = "",
  allowedResourceOrigins = [],
  allowedFieldIds,
  assets = [],
  values,
  isReadOnly = false,
  onSetFieldValue,
}: RuntimeDefinedComponentProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [compiledTsx, setCompiledTsx] = useState("");
  const [compileError, setCompileError] = useState("");
  const [frameHeight, setFrameHeight] = useState(120);
  const normalizedAssets = useMemo(() => normalizeAssets(assets), [assets]);
  const origins = useMemo(
    () => normalizeOrigins([...allowedResourceOrigins, ...normalizedAssets.map((asset) => asset.url)]),
    [allowedResourceOrigins, normalizedAssets],
  );
  const allowedFieldIdSet = useMemo(() => new Set(allowedFieldIds), [allowedFieldIds]);

  useEffect(() => {
    let cancelled = false;

    if (type === "html") return;

    void compileTsx(code).then((result) => {
      if (cancelled) return;
      setCompiledTsx(result.code);
      setCompileError(result.error);
    });

    return () => {
      cancelled = true;
    };
  }, [code, type]);

  const postRuntimeValues = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: `${MESSAGE_PREFIX}:values`, values, isReadOnly },
      "*",
    );
  }, [isReadOnly, values]);

  useEffect(() => {
    postRuntimeValues();
  }, [postRuntimeValues]);

  useEffect(() => {
    function handleMessage(event: MessageEvent<unknown>) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!event.data || typeof event.data !== "object") return;
      const message = event.data as { type?: string; fieldId?: unknown; value?: unknown; height?: unknown };
      if (message.type === `${MESSAGE_PREFIX}:height` && typeof message.height === "number") {
        const nextHeight = Math.max(80, Math.min(5000, Math.ceil(message.height)));
        setFrameHeight((current) => Math.abs(current - nextHeight) > 1 ? nextHeight : current);
        return;
      }
      if (message.type !== `${MESSAGE_PREFIX}:set-field` || typeof message.fieldId !== "string") return;
      if (isReadOnly || !allowedFieldIdSet.has(message.fieldId)) return;
      onSetFieldValue(message.fieldId, message.value);
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [allowedFieldIdSet, isReadOnly, onSetFieldValue]);

  const srcDoc = useMemo(() => buildRuntimeDocument({
    type,
    code: type === "tsx" ? compiledTsx : code,
    origins,
    assets: normalizedAssets,
  }), [code, compiledTsx, normalizedAssets, origins, type]);

  if (type === "tsx" && compileError) {
    return <pre className="w-full overflow-auto rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] p-3 text-xs text-[var(--color-danger)]">{compileError}</pre>;
  }

  return (
    <iframe
      ref={iframeRef}
      title={type === "html" ? "HTML 组件" : "TSX 组件"}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className="block w-full rounded-md border border-[var(--color-border)] bg-white"
      style={{ height: frameHeight }}
      srcDoc={srcDoc}
      onLoad={postRuntimeValues}
    />
  );
}

async function compileTsx(source: string): Promise<{ code: string; error: string }> {
  if (!source.trim()) return { code: "", error: "" };
  try {
    const ts = await import("typescript");
    const result = ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        jsxFactory: "h",
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2020,
      },
      reportDiagnostics: true,
      fileName: "component.tsx",
    });
    const diagnostics = result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error) ?? [];
    if (diagnostics.length > 0) {
      return { code: "", error: diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n") };
    }
    if (!/function\s+render\s*\(/.test(result.outputText)) {
      return { code: "", error: "TSX 组件需要导出一个 render(ctx) 函数。" };
    }
    return { code: result.outputText, error: "" };
  } catch {
    return { code: "", error: "TSX 编译器加载失败。" };
  }
}

function normalizeOrigins(input: string[]) {
  return [...new Set(input
    .map((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" ? url.origin : "";
      } catch {
        return "";
      }
    })
    .filter(Boolean))];
}

function normalizeAssets(assets: DefinedPageAsset[]) {
  const ids = new Set<string>();
  return assets.filter((asset) => {
    if (!asset.enabled || ids.has(asset.id) || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(asset.id)) return false;
    try {
      const url = new URL(asset.url);
      if (url.protocol !== "https:") return false;
      ids.add(asset.id);
      return true;
    } catch {
      return false;
    }
  });
}

function buildRuntimeDocument({ type, code, origins, assets }: { type: DefinedComponentType; code: string; origins: string[]; assets: DefinedPageAsset[] }) {
  const sourceList = origins.length > 0 ? origins.join(" ") : "'none'";
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${sourceList}`,
    `style-src 'unsafe-inline' ${sourceList}`,
    `img-src data: blob: ${sourceList}`,
    `font-src ${sourceList}`,
    `connect-src ${sourceList}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const bootstrap = `<script>(function(){
    let values = {}; let readOnly = false; const root = document.getElementById('root');
    const assets = ${serializeForInlineScript(assets)};
    const pendingAssets = new Map();
    const loadAsset = (id, type) => {
      const asset = assets.find((item) => item.id === id && item.type === type);
      if (!asset) return Promise.reject(new Error('未登记或类型不匹配的页面资源：' + id));
      if (pendingAssets.has(id)) return pendingAssets.get(id);
      const task = new Promise((resolve, reject) => {
        const node = document.createElement(type === 'script' ? 'script' : 'link');
        const timer = window.setTimeout(() => reject(new Error('资源加载超时：' + id)), 15000);
        node.onload = () => { window.clearTimeout(timer); resolve(undefined); };
        node.onerror = () => { window.clearTimeout(timer); reject(new Error('资源加载失败：' + id)); };
        if (asset.integrity) { node.integrity = asset.integrity; node.crossOrigin = 'anonymous'; }
        if (type === 'script') { node.src = asset.url; node.async = true; document.head.appendChild(node); }
        else { node.rel = 'stylesheet'; node.href = asset.url; document.head.appendChild(node); }
      });
      pendingAssets.set(id, task); return task;
    };
    window.ctx = { form: {
      getValue: (id) => values[id], getValues: () => ({ ...values }),
      setValue: (fieldId, value) => { if (!readOnly && typeof fieldId === 'string') parent.postMessage({ type: '${MESSAGE_PREFIX}:set-field', fieldId, value }, '*'); },
      isReadOnly: () => readOnly,
    }, assets: { loadScript: (id) => loadAsset(id, 'script'), loadStyle: (id) => loadAsset(id, 'style') }};
    window.h = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat() });
    window.__renderNode = (value) => {
      if (value == null || value === false) return document.createTextNode('');
      if (value instanceof Node) return value;
      if (typeof value === 'string' || typeof value === 'number') return document.createTextNode(String(value));
      if (typeof value.tag !== 'string') return document.createTextNode('');
      const element = document.createElement(value.tag);
      Object.entries(value.props || {}).forEach(([key, item]) => {
        if (key === 'className') element.setAttribute('class', String(item));
        else if (key.startsWith('on') && typeof item === 'function') element.addEventListener(key.slice(2).toLowerCase(), item);
        else if (key !== 'children' && item !== false && item != null) element.setAttribute(key, item === true ? '' : String(item));
      });
      (value.children || []).forEach((child) => element.appendChild(window.__renderNode(child)));
      return element;
    };
    window.__mount = () => {
      if (typeof window.render !== 'function') return;
      try { if (root) root.replaceChildren(window.__renderNode(window.render(window.ctx))); }
      catch (error) { root.textContent = error instanceof Error ? error.message : '组件执行失败'; }
    };
    let resizeFrame = 0;
    const reportHeight = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        const doc = document.documentElement; const body = document.body;
        // Some custom pages use an inner scroll container. Its scrollHeight is
        // not included in document.scrollHeight while the iframe is still short.
        const nestedContentBottom = body ? Array.from(body.querySelectorAll('*')).reduce((bottom, element) => {
          const rect = element.getBoundingClientRect();
          return Math.max(bottom, rect.top + Math.max(element.scrollHeight, element.clientHeight));
        }, 0) : 0;
        const height = Math.max(doc.scrollHeight, doc.offsetHeight, body ? body.scrollHeight : 0, body ? body.offsetHeight : 0, nestedContentBottom);
        parent.postMessage({ type: '${MESSAGE_PREFIX}:height', height }, '*');
      });
    };
    new ResizeObserver(reportHeight).observe(document.documentElement);
    if (body) new ResizeObserver(reportHeight).observe(body);
    new MutationObserver(reportHeight).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    window.addEventListener('load', reportHeight);
    reportHeight();
    [0, 100, 400, 1000, 2000].forEach((delay) => window.setTimeout(reportHeight, delay));
    window.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.type !== '${MESSAGE_PREFIX}:values') return;
      values = message.values && typeof message.values === 'object' ? message.values : {}; readOnly = Boolean(message.isReadOnly); window.__mount(); reportHeight();
    });
  })();</script>`;
  const body = type === "html" ? `${bootstrap}${code}` : `<div id="root"></div>${bootstrap}<script>${code}\nwindow.__mount();</script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}"><style>html,body{margin:0;min-height:0}*,*:before,*:after{box-sizing:border-box}</style></head><body>${body}</body></html>`;
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function serializeForInlineScript(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
