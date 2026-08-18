import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentSession, AgentUiAdapter } from "../contracts.js";

export class DefaultUiAdapter extends Service implements AgentUiAdapter {
  constructor(ctx: Context) { super(ctx, "ui"); }

  availableAgent() {
    return { id: "cordis-default", name: "Cordis Agent", description: "Cordis 插件运行时", isAiEmployee: true };
  }

  publicSession(session: AgentSession) {
    const { ownerKey: _ownerKey, ...safe } = session;
    return { ...safe, agentId: "cordis-default", source: "general", isPinned: false, status: "active" };
  }
}
