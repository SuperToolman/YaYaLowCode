/** Registry is scoped to one trusted Host. Rust authorizes every invocation before RPC. */
export function createToolRegistry() {
  const tools = new Map();
  return {
    register(tool) {
      if (!tool.name || tools.has(tool.name)) throw new Error("duplicate/invalid tool name");
      tools.set(tool.name, tool);
      return () => { if (tools.get(tool.name) === tool) tools.delete(tool.name); };
    },
    list: () => [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    async invoke(name, args, context) {
      const tool = tools.get(name);
      if (!tool) throw new Error("unknown tool");
      return tool.execute(args, context);
    },
  };
}
