export const name = "yaya-diagnostic";
export const inject = ["tools"];

export function apply(ctx) {
  const registry = ctx.get("tools");
  ctx.effect(() => registry.register({
    name: "diagnostic_echo",
    description: "Echo diagnostic text without business side effects.",
    inputSchema: { type: "object", properties: { text: { type: "string", maxLength: 4096 } }, required: ["text"], additionalProperties: false },
    async execute(args, { signal }) {
      signal.throwIfAborted();
      if (!args || typeof args.text !== "string" || args.text.length > 4096 || Object.keys(args).length !== 1) throw new Error("invalid arguments");
      await new Promise(resolve => setImmediate(resolve));
      signal.throwIfAborted();
      return { text: args.text, source: "cordis", pluginVersion: "1.0.0" };
    },
  }));
}
