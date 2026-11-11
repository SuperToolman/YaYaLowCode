// Minimal migration boundary for a legacy parameter/execute contract.
// No legacy package, service, agent object, context JWT or provider key is used.
export const name = 'yaya-sample-migrated-diagnostic';
export const inject = ['tools'];
export function apply(ctx) {
  const legacyDefinition = {
    name: 'migration_echo',
    description: 'Independent migration-contract sample.',
    parameters: { text: { type: 'string', required: true } },
    async execute(args, execution) {
      execution.signal.throwIfAborted();
      if (typeof args?.text !== 'string' || args.text.length > 4096) throw new Error('invalid arguments');
      return { text: args.text, migrated: true };
    },
  };
  ctx.effect(() => ctx.get('tools').register({
    name: legacyDefinition.name,
    description: legacyDefinition.description,
    inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 4096 } }, required: ['text'], additionalProperties: false },
    execute: (args, execution) => legacyDefinition.execute(args, { signal: execution.signal, scope: execution.scope }),
  }));
}
