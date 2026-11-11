import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFormSidebar } from "./useFormSidebar";
import { APP_NAVIGATION_CHANGED_EVENT } from "@/features/application/navigation-events";

const mocks = vi.hoisted(() => ({
  getAppNavigation: vi.fn(), getAppForms: vi.fn(),
  updateFormName: vi.fn(), deleteForm: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/app/form", useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/features/auth/components/AuthProvider", () => ({
  useAuth: () => ({ hasPermission: () => true, permissionsReady: true }),
}));
vi.mock("@/features/application/resources", () => ({
  getAppNavigation: mocks.getAppNavigation, getAppForms: mocks.getAppForms,
  invalidateAppResources: vi.fn(),
}));
vi.mock("@/features/application/api", () => ({
  updateFormName: mocks.updateFormName, deleteForm: mocks.deleteForm,
}));
vi.mock("./useNavigationDrag", () => ({ useNavigationDrag: () => ({}) }));
vi.mock("@/shared/lib/notify", () => ({
  notifyRequestError: vi.fn(), notify: { success: vi.fn(), error: vi.fn() },
}));

const item = { id: "nav", itemType: "form", title: "旧名称", pathSlug: "form", targetFormUuid: "form", sortOrder: 0, parentId: null };
const forms = [{ id: "form", formType: "normal" }];
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.getAppNavigation.mockResolvedValue([item]);
  mocks.getAppForms.mockResolvedValue(forms);
});
afterEach(cleanup);

describe("useFormSidebar refresh", () => {
  it("ignores an old initial response arriving after a deletion refresh", async () => {
    let resolveOld!: (items: unknown[]) => void;
    mocks.getAppNavigation.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce([]);
    const { result } = renderHook(() => useFormSidebar({ routeAppId: "app" }));
    act(() => window.dispatchEvent(new CustomEvent(APP_NAVIGATION_CHANGED_EVENT, { detail: { appId: "app" } })));
    await waitFor(() => expect(result.current.tree.some(node => node.id === "system-tasks")).toBe(true));
    await act(async () => { resolveOld([item]); });
    expect(result.current.items).toEqual([]);
  });

  it("updates the name and removes deleted forms immediately after successful actions", async () => {
    mocks.updateFormName.mockResolvedValue({ data: { code: 0 } });
    mocks.deleteForm.mockResolvedValue({ data: { code: 0 } });
    const { result } = renderHook(() => useFormSidebar({ routeAppId: "app" }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const node = result.current.tree.find(node => node.id === "nav")!;
    act(() => result.current.openFormAction(node, "rename"));
    act(() => result.current.setFormActionValue("新名称"));
    mocks.getAppNavigation.mockResolvedValue([{ ...item, title: "新名称" }]);
    act(() => result.current.handleFormAction());
    await waitFor(() => expect(result.current.visibleTree.find(node => node.id === "nav")?.name).toBe("新名称"));
    await waitFor(() => expect(result.current.formActionPending).toBe(false));

    act(() => result.current.openFormAction(node, "delete"));
    mocks.getAppNavigation.mockResolvedValue([]);
    mocks.getAppForms.mockResolvedValue([]);
    act(() => result.current.handleFormAction());
    await waitFor(() => expect(result.current.items).toEqual([]));
    expect(mocks.push).toHaveBeenCalledWith("/app");
  });
});
