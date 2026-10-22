// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Test-only base URL setup; production callers use the stable HTTP entry.
// eslint-disable-next-line no-restricted-imports
import { client } from "../app/lib/api-client/client.gen";
import { createRecord, updateRecord, deleteRecord } from "./records/api";
import { getNotificationSettings, updateNotificationSettings } from "../app/lib/http";
import { listMarketplaceApplications, rollbackMarketplaceInstallation } from "./application/api";
import { listModelRoutes } from "./settings/api";
import { uploadFile } from "./files/api";
import { listMailMessages } from "./mail/api";
import { getWorkflowNotificationPreferences } from "./workflow/api";
import { POST as login } from "../app/api/auth/login/route";
import { GET as session } from "../app/api/auth/session/route";
import { NextRequest } from "next/server";

const requests: Request[] = [];
beforeEach(() => {
  requests.length = 0;
  client.setConfig({ baseUrl: "http://localhost" });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (request: Request) => {
    requests.push(request);
    const pathname = new URL(request.url).pathname;
    const data = pathname.endsWith("local-login") ? { id: "user", username: "user", displayName: "User" }
      : pathname === "/api/files/upload" ? { fileId: "file", name: "sample.txt", size: 6, mimeType: "text/plain" }
      : pathname === "/api/mail/messages" ? { items: [], total: 0 }
      : pathname === "/api/workflow/notification-preferences" ? { inAppEnabled: true, pollIntervalSeconds: 60 }
      : pathname.includes("records") ? { id: "record", data: { name: "new" } }
      : [];
    return Response.json({ code: 0, message: "ok", data });
  }));
});
afterEach(() => { client.setConfig({ baseUrl: "" }); vi.unstubAllGlobals(); });

describe("migrated feature wire smoke (mock backend, no business writes)", () => {
  it("sends record CRUD through the generated methods", async () => {
    await createRecord("form", { name: "new" });
    await updateRecord("form", "record", { name: "edited" });
    await deleteRecord("form", "record");
    expect(requests.map(request => [request.method, new URL(request.url).pathname])).toEqual([
      ["POST", "/api/forms/form/records"], ["PATCH", "/api/forms/form/records/record"], ["DELETE", "/api/forms/form/records/record"],
    ]);
    expect(await requests[0].json()).toEqual({ data: { name: "new" } });
  });
  it("uses declared settings, market, mail and workflow paths", async () => {
    await getNotificationSettings(); await updateNotificationSettings({ body: { inAppEnabled: true } });
    await listModelRoutes(); await listMarketplaceApplications(); await rollbackMarketplaceInstallation("installation", "release");
    await listMailMessages({ folder: "inbox" }); await getWorkflowNotificationPreferences();
    expect(requests.map(request => request.method)).toEqual(["GET", "PUT", "GET", "GET", "POST", "GET", "GET"]);
    expect(await requests[4].json()).toEqual({ releaseId: "release" });
    expect(new URL(requests[5].url).searchParams.get("folder")).toBe("inbox");
  });
  it("uploads multipart files without JSON serialization", async () => {
    const result = await uploadFile(new File(["sample"], "sample.txt", { type: "text/plain" }));
    expect(result.fileId).toBe("file");
    expect(requests[0].headers.get("content-type")).toContain("multipart/form-data");
    expect((await requests[0].formData()).get("file")).toBeInstanceOf(File);
  });
  it("preserves login cookie and BFF session contract", async () => {
    const response = await login(new Request("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify({ username: "user", password: "password" }) }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("yaya-auth-token=");
    const sessionResponse = session(new NextRequest("http://localhost/api/auth/session", { headers: { cookie: `yaya-auth-token=${payload.data.token}` } }));
    expect(await sessionResponse.json()).toMatchObject({ code: 0, data: { token: payload.data.token, user: { id: "user" } } });
    expect(new URL(requests[0].url).pathname).toBe("/api/identity/local-login");
  });
});
