import type { Context } from "@deepseek-ai/cordis";

export const platformTools = Object.assign((ctx: Context) => {
  const unregister = [
    ctx.tools.register({
      name: "list_apps",
      description: "列出当前用户可访问的应用。",
      inputSchema: { type: "object", additionalProperties: false },
      requiresApproval: false,
      execute: (_input, request) => ctx.platform.request(request, "/api/apps"),
    }),
    ctx.tools.register({
      name: "list_forms",
      description: "列出当前用户在指定应用中可访问的表单。",
      inputSchema: { type: "object", properties: { appId: { type: "string" } }, additionalProperties: false },
      requiresApproval: false,
      execute: (input, request) => {
        const appId = typeof input === "object" && input && "appId" in input ? String(input.appId) : request.appId;
        if (!appId) throw new Error("appId is required");
        return ctx.platform.request(request, `/api/apps/${encodeURIComponent(appId)}/forms`);
      },
    }),
  ];
  return () => unregister.forEach((dispose) => dispose());
}, { inject: ["platform", "tools"] });
