import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from 'cordis';
import { createToolRegistry } from '../src/registry.mjs';
import * as sample from '../../fixtures/plugin-adapters/diagnostic/entry.mjs';

test('versioned independent migration sample injects, calls and unloads', async () => {
  const ctx = new Context(); const registry = createToolRegistry();
  const provider = await ctx.plugin(context => context.provide('tools', registry));
  const plugin = await ctx.plugin(sample);
  assert.equal(registry.list()[0].name, 'migration_echo');
  assert.deepEqual(await registry.invoke('migration_echo', { text: 'migration' }, { signal: new AbortController().signal, scope: {} }), { text: 'migration', migrated: true });
  await plugin.dispose(); assert.equal(registry.list().length, 0); await provider.dispose();
});
