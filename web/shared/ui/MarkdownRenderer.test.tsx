import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { AgentMarkdown } from "@/features/agent-v2/components/AgentMarkdown";

const mocks = vi.hoisted(() => ({ error: vi.fn(), writeText: vi.fn() }));
vi.mock("@/shared/lib/notify", () => ({ notify: { error: mocks.error } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeText.mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: mocks.writeText } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("MarkdownRenderer", () => {
  it("renders standard Markdown and GFM with accessible links and literal inline code", () => {
    const { container } = render(<MarkdownRenderer content={'# 标题\n\n正文 **加粗** ~~删除~~ `a < b`\n\n- 项目\n- [x] 已完成\n\n1. 有序项目\n\n> 引用\n\n| 左 | 右 |\n| --- | ---: |\n| A | B |\n\n[站点](https://example.com)\n\n![示意图](https://example.com/a.png)\n\n---'} />);
    expect(screen.getByRole("heading", { name: "标题" })).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("加粗");
    expect(container.querySelector("del")?.textContent).toBe("删除");
    expect(container.querySelector("code")?.textContent).toBe("a < b");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelector("ol")?.textContent).toContain("有序项目");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector("blockquote")?.textContent).toContain("引用");
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "B" }).getAttribute("style")).toContain("right");
    expect(screen.getByRole("link", { name: "站点" }).getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: "站点" }).getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("img", { name: "示意图" })).toBeTruthy();
    expect(container.querySelector("hr")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "复制代码" })).toBeNull();
  });

  it("highlights known languages and copies exact code including indentation and trailing blank lines", async () => {
    const source = 'const value = "你好";\n  console.log(value);\n\n  \n';
    const { container } = render(<MarkdownRenderer content={`\`\`\`js\n${source}\`\`\``} />);
    expect(container.querySelector(".token.keyword")?.textContent).toBe("const");
    expect(container.querySelector("pre code")?.textContent).toBe(source);
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith(source));
    expect(await screen.findByText("已复制")).toBeTruthy();
  });

  it.each(["unknown-language", ""])("falls back to readable code for %s", async language => {
    const code = 'a < b && b > c\n';
    const { container } = render(<MarkdownRenderer content={`\`\`\`${language}\n${code}\`\`\``} />);
    expect(container.querySelector("pre code")?.textContent).toBe(code);
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith(code));
  });

  it("reports clipboard failures through the shared notification entry", async () => {
    mocks.writeText.mockRejectedValue(new Error("denied"));
    render(<MarkdownRenderer content={'```\nx\n```'} />);
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("代码复制失败", expect.any(Object)));
    expect(screen.queryByText("已复制")).toBeNull();
  });

  it("enables optional anchors with unique duplicate-heading IDs and same-page navigation", () => {
    const { rerender } = render(<MarkdownRenderer content={'# Hello\n\n# Hello'} />);
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<MarkdownRenderer content={'# Hello\n\n# Hello'} showHeadingAnchors />);
    const headings = screen.getAllByRole("heading");
    expect(headings.map(heading => heading.id)).toEqual(["hello", "hello-1"]);
    const links = screen.getAllByRole("link", { name: "链接到此标题" });
    expect(links.map(link => link.getAttribute("href"))).toEqual(["#hello", "#hello-1"]);
    expect(links[0].getAttribute("target")).toBeNull();
  });

  it("does not interpret raw HTML or preserve unsafe URLs", () => {
    const { container } = render(<MarkdownRenderer content={'<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[危险](javascript:alert%281%29)\n\n![危险图片](javascript:alert%281%29)'} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(screen.getByText("危险").getAttribute("href")).not.toMatch(/^javascript:/);
    expect(container.querySelector("img")?.getAttribute("src") ?? "").not.toMatch(/^javascript:/);
  });

  it("preserves repeated prose, list items and code instead of applying Agent normalization", () => {
    const { container } = render(<MarkdownRenderer content={'重复段落\n\n重复段落\n\n- 保留重复项目\n- 保留重复项目\n\n```\nhello hello\n```'} compact className="consumer-class" />);
    expect(screen.getAllByText("重复段落")).toHaveLength(2);
    expect(screen.getAllByText("保留重复项目")).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toBe("hello hello\n");
    expect(container.firstElementChild?.getAttribute("data-compact")).toBe("true");
    expect(container.firstElementChild?.className).toContain("consumer-class");
  });

  it("updates streaming content and copies the latest unterminated code block", async () => {
    const { rerender, container } = render(<MarkdownRenderer content={'```js\nconst a ='} />);
    expect(container.querySelector("pre")?.textContent).toContain("const a =");
    rerender(<MarkdownRenderer content={'```js\nconst a = 1;'} />);
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith("const a = 1;\n"));
    rerender(<MarkdownRenderer content={'```js\nconst a = 1;\n```\n\n完成'} />);
    expect(screen.getByText("完成")).toBeTruthy();
  });
});

it("keeps Agent normalization in the Agent wrapper and preserves its compact interface", () => {
  const { container } = render(<AgentMarkdown content={'##标题\n\n- 重复列表项目\n- 重复列表项目'} compact />);
  expect(screen.getByRole("heading", { name: "标题" })).toBeTruthy();
  expect(screen.getAllByText("重复列表项目")).toHaveLength(1);
  expect(screen.queryByRole("link")).toBeNull();
  expect(container.querySelector('[data-compact="true"]')).not.toBeNull();
});
