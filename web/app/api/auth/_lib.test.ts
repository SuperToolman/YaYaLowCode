// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLoginResponse, signToken, verifyAuthToken } from "./_lib";
afterEach(() => vi.unstubAllEnvs());
describe("authenticated session tokens", () => {
  it("rejects forged, expired and malformed JWTs", () => {
    vi.stubEnv("AUTH_TOKEN_SECRET", "test-secret");
    const payload = { sub: "actor", exp: Math.floor(Date.now() / 1000) + 60 };
    expect(verifyAuthToken(signToken(payload, "test-secret"))?.sub).toBe("actor");
    expect(verifyAuthToken(signToken(payload, "wrong-secret"))).toBeNull();
    expect(verifyAuthToken(signToken({ ...payload, exp: 1 }, "test-secret"))).toBeNull();
    expect(verifyAuthToken("eyJhbGciOiJub25lIn0.e30.")).toBeNull();
  });
  it("retains a distinct operator identity and caps the session at the control-plane expiry", async () => {
    vi.stubEnv("AUTH_TOKEN_SECRET", "test-secret");
    const expiresAt = Date.now() + 45_000;
    const response = createLoginResponse({ id: "distinct-operator", username: "staff", displayName: "平台运维 · staff" }, { actor: "staff-id", session: "opaque-session", expiresAt });
    const result = await response.json();
    const claims = verifyAuthToken(result.data.token)!;
    expect(claims.sub).toBe("distinct-operator");
    expect(claims.operations_actor).toBe("staff-id");
    expect(claims.operations_session).toBe("opaque-session");
    expect(Number(claims.exp) * 1000).toBeLessThanOrEqual(expiresAt);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });
});
