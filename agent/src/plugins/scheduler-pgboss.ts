import PgBoss from "pg-boss";
import { Service, type Context } from "@deepseek-ai/cordis";
import type { AgentScheduler } from "../contracts.js";

export function createPersistentScheduler(connectionString: string) {
  return class PersistentScheduler extends Service implements AgentScheduler {
    private readonly boss = new PgBoss(connectionString);
    private readonly ready: Promise<void>;
    constructor(ctx: Context) { super(ctx, "scheduler"); this.ready = this.boss.start().then(() => undefined); }
    register(name: string, task: (payload: unknown) => Promise<void>) {
      void this.ready.then(async () => {
        await this.boss.createQueue(name);
        await this.boss.work(name, async (jobs) => { for (const job of jobs) await task(job.data); });
      });
      return () => { void this.ready.then(() => this.boss.offWork(name)); };
    }
    schedule(name: string, delayMs: number, task: () => Promise<void>) {
      const unregister = this.register(name, async () => task());
      void this.ready.then(() => this.boss.send(name, {}, { startAfter: delayMs / 1000 }));
      return unregister;
    }
  };
}
