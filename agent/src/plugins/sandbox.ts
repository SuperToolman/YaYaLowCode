import { Service, type Context } from "@deepseek-ai/cordis";
import { spawn } from "node:child_process";
import type { AgentSandbox } from "../contracts.js";

export class SandboxService extends Service implements AgentSandbox {
  constructor(ctx: Context) { super(ctx, "sandbox"); }
  async assertAllowed(input: { command?: string; cwd?: string; network?: boolean }) {
    if (process.env.AGENT_SANDBOX_ENABLED !== "true") throw new Error("Sandbox execution is disabled");
    if (input.network && process.env.AGENT_SANDBOX_ALLOW_NETWORK !== "true") throw new Error("Sandbox network access is disabled");
    const root = process.env.AGENT_SANDBOX_WORKSPACE_ROOT;
    if (input.cwd && root && !input.cwd.startsWith(root)) throw new Error("Sandbox cwd is outside the allowed workspace");
    if (input.command && input.command.length > Number(process.env.AGENT_SANDBOX_MAX_COMMAND_CHARS ?? "4096")) throw new Error("Sandbox command exceeds the configured limit");
  }
  async execute(input: { command: string; cwd?: string; network?: boolean; timeoutMs?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    await this.assertAllowed(input);
    const workspace = input.cwd ?? process.env.AGENT_SANDBOX_WORKSPACE_ROOT;
    if (!workspace) throw new Error("AGENT_SANDBOX_WORKSPACE_ROOT is required");
    const timeoutMs = Math.min(input.timeoutMs ?? 30000, Number(process.env.AGENT_SANDBOX_MAX_TIMEOUT_MS ?? "120000"));
    const args = ["run", "--rm", "--read-only", "--pids-limit", process.env.AGENT_SANDBOX_PIDS_LIMIT ?? "128", "--memory", process.env.AGENT_SANDBOX_MEMORY ?? "512m", "--cpus", process.env.AGENT_SANDBOX_CPUS ?? "1", "--mount", `type=bind,src=${workspace},dst=/workspace,rw`, "--workdir", "/workspace"];
    args.push(input.network ? "--network=bridge" : "--network=none", process.env.AGENT_SANDBOX_IMAGE ?? "node:22-bookworm-slim", "sh", "-lc", input.command);
    return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
      const child = spawn(process.env.AGENT_SANDBOX_DOCKER_BIN ?? "docker", args, { windowsHide: true });
      let stdout = ""; let stderr = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Sandbox execution timed out")); }, timeoutMs);
      child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (exitCode) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: exitCode ?? 1 }); });
    });
  }
}
