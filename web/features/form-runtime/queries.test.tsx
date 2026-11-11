import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRuntimeIdentityCatalog } from "./api";
import { useRuntimeMemberUsers } from "./queries";

const auth = vi.hoisted(() => ({ token: "session-a", user: { id: "viewer" }, permissions: [] as string[] }));
vi.mock("@/features/auth/components/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("./api", () => ({ fetchRuntimeIdentityCatalog: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); auth.token = "session-a"; });

function setup(enabled: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useRuntimeMemberUsers(enabled), { wrapper });
}

describe("表格成员目录", () => {
  it("加载用户后提供姓名映射，并在会话变化时重新加载", async () => {
    vi.mocked(fetchRuntimeIdentityCatalog).mockResolvedValue({ users: [{ id: "u", displayName: "张三", avatarUrl: null, jobNumber: null, roles: [], sourceType: "local", status: "active" }], roles: [] });
    const { result, rerender } = setup(true);
    await waitFor(() => expect(result.current.get("u")?.displayName).toBe("张三"));
    rerender();
    expect(fetchRuntimeIdentityCatalog).toHaveBeenCalledTimes(1);
    auth.token = "session-b";
    vi.mocked(fetchRuntimeIdentityCatalog).mockResolvedValue({ users: [], roles: [] });
    rerender();
    expect(result.current.size).toBe(0);
    await waitFor(() => expect(fetchRuntimeIdentityCatalog).toHaveBeenCalledTimes(2));
  });
  it("没有成员列时不加载目录", () => {
    setup(false);
    expect(fetchRuntimeIdentityCatalog).not.toHaveBeenCalled();
  });
  it("目录请求失败时保留空映射，表格可以回退显示", async () => {
    vi.mocked(fetchRuntimeIdentityCatalog).mockRejectedValue(new Error("unavailable"));
    const { result } = setup(true);
    await waitFor(() => expect(fetchRuntimeIdentityCatalog).toHaveBeenCalledTimes(1));
    expect(result.current.size).toBe(0);
  });
});
