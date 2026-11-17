import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarketSubmissionsDialog } from "./MarketSubmissionsDialog";
const mocks = vi.hoisted(() => ({ list: vi.fn(), retry: vi.fn() }));
vi.mock("../api", () => ({
  listMarketSubmissionRecords: mocks.list,
  retryMarketSubmission: mocks.retry,
}));
const record = (id: string, status: string, type = "new_listing") => ({
  submissionId: id,
  appId: "a",
  appName: id,
  version: "1.0.0",
  status,
  submittedAt: 1,
  reviewReason: status === "rejected" ? "请补充说明" : "",
  productId: "p",
  snapshot: { submissionType: type, manifest: { members: [] } },
});
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mocks.list.mockResolvedValue({
    records: [
      record("首次申请", "rejected"),
      record("升级申请", "approved", "version_upgrade"),
      record("失败上传", "upload_pending"),
    ],
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("shows historical rejection reasons and distinct request types and resubmits the chosen record", async () => {
  const resubmit = vi.fn();
  render(<MarketSubmissionsDialog onClose={vi.fn()} onResubmit={resubmit} />);
  await screen.findByText("请补充说明");
  expect(screen.getByText("版本升级")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "修改后重新申请" }));
  expect(resubmit).toHaveBeenCalledWith(
    expect.objectContaining({ submissionId: "首次申请" }),
  );
  fireEvent.click(screen.getByRole("radio", { name: "已通过" }));
  expect(screen.queryByText("请补充说明")).toBeNull();
  expect(screen.getByText("升级申请", { selector: "p" })).toBeTruthy();
});
it("retries the original submission ID and refreshes the records", async () => {
  mocks.retry.mockResolvedValue({});
  render(<MarketSubmissionsDialog onClose={vi.fn()} onResubmit={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "重试上传" }));
  await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("失败上传"));
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
});
it("retains local history and warns when operations cannot synchronize", async () => {
  mocks.list.mockResolvedValue({
    records: [record("历史记录", "rejected")],
    syncError: "运营平台不可用，审核状态可能尚未更新",
  });
  render(<MarketSubmissionsDialog onClose={vi.fn()} onResubmit={vi.fn()} />);
  expect(
    await screen.findByText("运营平台不可用，审核状态可能尚未更新"),
  ).toBeTruthy();
  expect(screen.getByText("历史记录", { selector: "p" })).toBeTruthy();
});
