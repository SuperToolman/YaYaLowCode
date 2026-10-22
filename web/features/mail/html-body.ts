import DOMPurify from "dompurify";

// Scripts are removed and blocked by both CSP and the iframe sandbox.
export function mailHtmlDocument(html: string, inlineImages: Record<string, string> = {}) {
  const normalizeId = (value: string) => {
    let id = value.trim();
    try { id = decodeURIComponent(id); } catch { /* Some senders use literal percent signs. */ }
    return id.replace(/^<|>$/g, "");
  };
  const resolveId = (rawId: string) => {
    const id = normalizeId(rawId);
    // Outlook and forwarded messages sometimes change Content-ID casing.
    const matches = Object.keys(inlineImages).filter(key => normalizeId(key).toLowerCase() === id.toLowerCase());
    const source = inlineImages[id] || (matches.length === 1 ? inlineImages[matches[0]] : undefined);
    if (!source) throw new Error(`邮件内嵌图片缺失或格式不受支持（Content-ID：${id}）`);
    if (!/^data:image\/(?:png|jpeg|gif|webp|bmp|x-icon|vnd\.microsoft\.icon|avif);base64,[A-Za-z0-9+/]*={0,2}$/i.test(source)) throw new Error("邮件内嵌图片数据格式不正确");
    return source;
  };
  const resolveCss = (value: string) => value.replace(/url\(\s*(["']?)cid:([^"')]+)\1\s*\)/gi, (_, quote: string, id: string) => `url("${resolveId(id.trim())}")`);
  // Parse first: obsolete Outlook conditional comments, quoted text and script
  // contents must not be mistaken for images actually used by the browser.
  const markup = new DOMParser().parseFromString(html, "text/html");
  for (const element of markup.querySelectorAll("img[src], [background]")) {
    const attribute = element.hasAttribute("background") ? "background" : "src";
    const value = element.getAttribute(attribute) || "";
    if (/^cid:/i.test(value)) element.setAttribute(attribute, resolveId(value.slice(4)));
  }
  for (const element of markup.querySelectorAll("[style]")) element.setAttribute("style", resolveCss(element.getAttribute("style") || ""));
  for (const style of markup.querySelectorAll("style")) style.textContent = resolveCss(style.textContent || "");
  for (const element of markup.querySelectorAll<HTMLElement>("[background]")) {
    const image = element.getAttribute("background") || "";
    element.removeAttribute("background");
    if (/^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp|bmp|x-icon|vnd\.microsoft\.icon|avif);base64,)/i.test(image)) element.style.backgroundImage = `url(${JSON.stringify(image)})`;
  }
  const clean = DOMPurify.sanitize(markup.documentElement.outerHTML, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["form", "input", "button", "textarea", "select", "iframe", "object", "embed", "video", "audio", "link", "meta", "base"],
    FORBID_ATTR: ["srcset", "ping", "autofocus"],
  });
  const document = new DOMParser().parseFromString(clean, "text/html");
  for (const image of document.querySelectorAll("img")) {
    const src = image.getAttribute("src") || "";
    if (src && !/^(https?:\/\/|data:image\/(?:png|jpeg|gif|webp|bmp|x-icon|vnd\.microsoft\.icon|avif);base64,)/i.test(src)) throw new Error("邮件图片地址不受支持，无法完整显示正文");
    image.setAttribute("referrerpolicy", "no-referrer");
  }
  for (const link of document.querySelectorAll("a")) {
    if (!/^(https?:\/\/|mailto:)/i.test(link.getAttribute("href") || "")) link.removeAttribute("href");
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }
  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: http: data:; base-uri 'none'; form-action 'none'`;
  document.head.prepend(policy);
  const style = document.createElement("style");
  style.textContent = "body{margin:16px;font:14px/1.6 Arial,sans-serif;overflow-wrap:anywhere;color:#202124;background:#fff}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}a{color:#1769aa}";
  document.head.append(style);
  return `<!doctype html>${document.documentElement.outerHTML}`;
}
