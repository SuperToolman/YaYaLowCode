// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const exchange = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/http", () => ({ exchangeOperationsAccess: exchange }));
vi.mock("@/shared/lib/backend-client", () => ({ createBackendSdkClient: () => ({}) }));
import { POST } from "./route";
import { verifyAuthToken } from "../_lib";
beforeEach(() => { exchange.mockReset(); vi.stubEnv("AUTH_TOKEN_SECRET", "test-secret"); });
afterEach(() => vi.unstubAllEnvs());
function request(origin = "http://customer.local", code = "a".repeat(64)) {
  return new Request("http://customer.local/api/auth/operations", { method: "POST", headers: { origin, host: "customer.local", "content-type": "application/json" }, body: JSON.stringify({ code }) });
}
it("rejects cross-origin and malformed tickets before contacting the API", async () => {
  expect((await POST(request("http://attacker.local"))).status).toBe(403);
  expect((await POST(request("http://customer.local", "bad"))).status).toBe(400);
  expect(exchange).not.toHaveBeenCalled();
});
it("exchanges a one-time ticket for a separate signed operator session", async () => {
  exchange.mockResolvedValue({ response: { status: 200 }, data: { code: 0, data: { id: "operator-user", username: "admin", displayName: "平台运维 · admin", operationsSession: "opaque", operationsActor: "staff", expiresAt: Date.now() + 60_000 } } });
  const response = await POST(request());
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.data.user.id).toBe("operator-user");
  expect(verifyAuthToken(result.data.token)?.operations_actor).toBe("staff");
  expect(exchange.mock.calls[0][0].body).toEqual({ code: "a".repeat(64) });
});
it("preserves rejected-ticket errors and never creates a login cookie", async () => {
  exchange.mockResolvedValue({ response: { status: 403 }, error: { message: "凭证已使用" } });
  const response = await POST(request());
  expect(response.status).toBe(403);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect((await response.json()).message).toBe("凭证已使用");
});
