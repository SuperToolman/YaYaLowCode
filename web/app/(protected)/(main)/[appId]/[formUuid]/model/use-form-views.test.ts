import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFormViews, type ViewConfig } from "./use-form-views";
import { deleteFormView, updateFormView } from "@/features/form-runtime/api";
import { notify } from "@lib/notify";

vi.mock("@/features/form-runtime/api", () => ({
  listFormViews: vi.fn(async () => ({ data: { code: 0, data: [{ viewUuid: "custom", name: "原名称", config, updatedAt: "before" }] } })),
  createFormView: vi.fn(),
  updateFormView: vi.fn(),
  deleteFormView: vi.fn(),
}));
vi.mock("@lib/notify", () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

const config: ViewConfig = { visibleFieldIds: ["field"], sortableFieldIds: ["field"], filters: [], sorts: [] };

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

async function setup() {
  const hook = renderHook(() => useFormViews({ formUuid: "form", defaultViewConfig: config, enabled: true }));
  await waitFor(() => expect(hook.result.current.isReady).toBe(true));
  act(() => hook.result.current.setActiveViewId("view-custom"));
  act(() => hook.result.current.openViewConfig("filters"));
  return hook;
}

it("persists a trimmed name while preserving unapplied filter changes", async () => {
  const { result } = await setup();
  const draft = { ...config, filters: [{ id: "rule", fieldId: "field", operator: "contains" as const, value: "draft" }] };
  act(() => {
    result.current.setViewConfigDraft(draft);
    result.current.setViewNameDraft("  新名称  ");
  });
  vi.mocked(updateFormView).mockResolvedValueOnce({ data: { code: 0, data: { name: "新名称", updatedAt: "after" } } } as never);
  await act(async () => result.current.renameActiveView());
  expect(updateFormView).toHaveBeenCalledWith(expect.objectContaining({ path: { formUuid: "form", viewUuid: "custom" }, body: { name: "新名称", config } }));
  expect(result.current.activeFormView.name).toBe("新名称");
  expect(result.current.viewConfigDraft).toEqual(draft);
});

it("keeps the saved name when renaming fails and rejects empty names", async () => {
  const { result } = await setup();
  act(() => result.current.setViewNameDraft(" "));
  await act(async () => result.current.renameActiveView());
  expect(updateFormView).not.toHaveBeenCalled();
  act(() => result.current.setViewNameDraft("新名称"));
  vi.mocked(updateFormView).mockRejectedValueOnce(new Error("offline"));
  await act(async () => result.current.renameActiveView());
  expect(result.current.activeFormView.name).toBe("原名称");
  expect(result.current.isRenamingView).toBe(false);
  expect(notify.error).toHaveBeenCalledWith("修改视图名称失败");
});

it("only removes the view after successful deletion and closes its settings", async () => {
  const { result } = await setup();
  act(() => result.current.deleteView("view-custom"));
  vi.mocked(deleteFormView).mockResolvedValueOnce({ data: { code: 1, message: "failed" } } as never);
  await act(async () => { await result.current.confirmDeleteView(); });
  expect(result.current.views).toHaveLength(2);
  expect(result.current.viewDeleteTarget?.id).toBe("view-custom");
  expect(result.current.viewConfigMode).toBe("filters");
  vi.mocked(deleteFormView).mockResolvedValueOnce({ data: { code: 0 } } as never);
  await act(async () => {
    const fallback = await result.current.confirmDeleteView();
    expect(fallback?.id).toBe("default");
  });
  expect(result.current.views).toHaveLength(1);
  expect(result.current.viewDeleteTarget).toBeNull();
  expect(result.current.viewConfigMode).toBeNull();
  expect(result.current.viewConfigDraft).toBeNull();
});

it("protects the default view from renaming and deletion", async () => {
  const { result } = await setup();
  act(() => result.current.setActiveViewId("default"));
  act(() => {
    result.current.setViewNameDraft("改名");
    result.current.deleteView("default");
  });
  await act(async () => result.current.renameActiveView());
  expect(updateFormView).not.toHaveBeenCalled();
  expect(result.current.viewDeleteTarget).toBeNull();
});
