import { beforeEach, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports -- Mock the generated transport while testing the mail API boundary.
import { sendMail as command, listMailMessages as listCommand, getMailMessage as detailCommand } from "@/app/lib/http";
import { sendMail, listMailMessages, getMailMessage } from "./api";

vi.mock("@/app/lib/http", () => ({ sendMail: vi.fn(), listMailMessages: vi.fn(), getMailMessage: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const payload = { to: ["to@example.com"], cc: ["cc@example.com"], bcc: ["bcc@example.com"], subject: "主题", text: "正文" };

it("uses generated command and returns accepted result", async () => {
  vi.mocked(command).mockResolvedValue({ data: { code: 0, message: "ok", time: "", data: { accepted: true, requestId: "test" } }, response: new Response(), request: new Request("http://localhost") });
  await expect(sendMail(payload)).resolves.toEqual({ accepted: true, requestId: "test" });
  expect(command).toHaveBeenCalledWith({ body: payload, responseStyle: "fields" });
});
it("keeps safe server error and rejects unsuccessful business result", async () => {
  vi.mocked(command).mockResolvedValue({ data: undefined, error: { message: "邮件服务未配置" }, response: new Response(null, { status: 400 }), request: new Request("http://localhost") });
  await expect(sendMail(payload)).rejects.toThrow("邮件服务未配置");
});
it("propagates network failure", async () => {
  vi.mocked(command).mockRejectedValue(new Error("网络请求失败"));
  await expect(sendMail(payload)).rejects.toThrow("网络请求失败");
});

it("passes folder and UID cursor to the generated IMAP boundary", async () => {
  const data = { items: [], uidValidity: 9, nextBeforeUid: 12 };
  vi.mocked(listCommand).mockResolvedValue({ data: { code: 0, data, time: "", message: "ok" }, response: new Response(), request: new Request("http://localhost") });
  await expect(listMailMessages({ folder: "sent", beforeUid: 42, uidValidity: 9 })).resolves.toEqual(data);
  expect(listCommand).toHaveBeenCalledWith({ query: { folder: "sent", beforeUid: 42, uidValidity: 9 }, responseStyle: "fields" });
});
it("rejects a stale mailbox UID instead of displaying another message", async () => {
  vi.mocked(detailCommand).mockResolvedValue({ data: undefined, error: { message: "邮箱文件夹已更新，请刷新列表" }, response: new Response(null, { status: 400 }), request: new Request("http://localhost") });
  await expect(getMailMessage(42, { folder: "inbox", uidValidity: 9 })).rejects.toThrow("邮箱文件夹已更新");
});
