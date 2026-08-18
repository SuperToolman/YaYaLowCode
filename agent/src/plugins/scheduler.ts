import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentScheduler } from "../contracts.js";

export class SchedulerService extends Service implements AgentScheduler {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly handlers = new Map<string, (payload: unknown) => Promise<void>>();
  constructor(ctx: Context) { super(ctx, "scheduler"); }
  register(name: string, task: (payload: unknown) => Promise<void>) { this.handlers.set(name, task); return () => this.handlers.delete(name); }
  schedule(name: string, delayMs: number, task: () => Promise<void>) {
      if (delayMs < 0 || delayMs > Number(process.env.AGENT_SCHEDULER_MAX_DELAY_MS ?? "604800000")) throw new Error("Scheduled delay is outside the configured limit");
      const timer = setTimeout(() => { this.timers.delete(timer); void task(); }, delayMs);
      this.timers.add(timer);
      return () => { clearTimeout(timer); this.timers.delete(timer); };
  }
}
