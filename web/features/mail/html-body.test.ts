import { expect, it } from "vitest";
import { mailHtmlDocument } from "./html-body";

it("keeps email formatting while removing executable markup and unsafe navigation", () => {
  const source = mailHtmlDocument('<style>td{color:red}</style><table><tr><td style="color:blue">Hello</td></tr></table><script>alert(1)</script><img src="https://example.com/pixel" onerror="alert(1)"><a href="javascript:alert(1)">Unsafe</a><form action="https://example.com"><input></form><iframe src="https://example.com"></iframe><meta http-equiv="refresh" content="0;url=https://example.com">');
  const doc = new DOMParser().parseFromString(source, "text/html");
  expect(doc.querySelector("td")?.textContent).toBe("Hello");
  expect(doc.querySelector("td")?.getAttribute("style")).toBe("color:blue");
  expect(doc.querySelector("script, form, input, iframe")).toBeNull();
  expect(doc.querySelector("img")?.hasAttribute("onerror")).toBe(false);
  expect(doc.querySelector("img")?.getAttribute("src")).toBe("https://example.com/pixel");
  expect(doc.querySelector("a")?.hasAttribute("href")).toBe(false);
  expect(doc.querySelectorAll("meta")).toHaveLength(1);
  expect(doc.querySelector("meta")?.content).toContain("default-src 'none'");
});

it("enables only HTTP images on request and opens safe links without a referrer", () => {
  const doc = new DOMParser().parseFromString(mailHtmlDocument('<img src="https://example.com/image"><a href="https://example.com">Site</a>'), "text/html");
  expect(doc.querySelectorAll("img[src]")).toHaveLength(1);
  expect(doc.querySelector("img")?.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(doc.querySelector("a")?.getAttribute("target")).toBe("_blank");
  expect(doc.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(doc.querySelector("meta")?.content).toContain("img-src https: http:");
});

it("reports unsupported inline attachment images rather than silently losing them", () => {
  expect(() => mailHtmlDocument('<img src="cid:attachment">')).toThrow("Content-ID：attachment");
});

it("resolves repeated, encoded and uppercase CID references while preserving layout", () => {
  const source = mailHtmlDocument('<style>.logo{background-image:url(cid:logo%40example)}</style><table background="cid:logo@example"><tr><td><img src="CID:logo%40example"><img src="cid:logo@example"></td></tr></table>', { "logo@example": "data:image/png;base64,aGVsbG8=" });
  const doc = new DOMParser().parseFromString(source, "text/html");
  expect(doc.querySelectorAll('img[src="data:image/png;base64,aGVsbG8="]')).toHaveLength(2);
  expect(doc.querySelector("table")?.style.backgroundImage).toContain("data:image/png;base64,aGVsbG8=");
  expect(source).not.toContain("cid:");
  expect(doc.querySelector("meta")?.content).toContain("img-src https: http: data:");
});
it("rejects unsafe image payloads supplied as CID resources", () => {
  expect(() => mailHtmlDocument('<img src="cid:bad">', { bad: "data:image/svg+xml;base64,PHN2Zz4=" })).toThrow("数据格式不正确");
});

it("ignores obsolete Outlook conditional images and CID references in quoted text", () => {
  const source = mailHtmlDocument('<!--[if vml]><img src="cid:image001.png@01D3AC7E.BD871640"><![endif]--><p>Old reference: cid:missing</p><img src="https://example.com/current.png">');
  const doc = new DOMParser().parseFromString(source, "text/html");
  expect(doc.querySelectorAll("img")).toHaveLength(1);
  expect(doc.querySelector("p")?.textContent).toContain("cid:missing");
});

it("matches entity-encoded and differently cased Outlook content IDs", () => {
  const source = mailHtmlDocument('<img src="cid:image001.png&#64;01D3AC7E.BD871640">', { "<IMAGE001.PNG@01d3ac7e.bd871640>": "data:image/png;base64,aGVsbG8=" });
  const doc = new DOMParser().parseFromString(source, "text/html");
  expect(doc.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=");
});

it("renders Aliyun generic-attachment images after the server identifies their actual format", () => {
  const source = mailHtmlDocument('<p>正文</p><img src="cid:__aliyun175446669277980181"><img src="cid:__aliyun175446669277980182">', {
    __aliyun175446669277980181: "data:image/jpeg;base64,/9j/4A==",
    __aliyun175446669277980182: "data:image/png;base64,iVBORw0KGgo=",
  });
  const doc = new DOMParser().parseFromString(source, "text/html");
  expect(doc.querySelectorAll("img[src^='data:image/']")).toHaveLength(2);
  expect(doc.querySelector("p")?.textContent).toBe("正文");
  expect(source).not.toContain("cid:");
});
