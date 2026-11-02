/**
 * Every `ctx.<handler>` a command body reads must be forwarded by the bridge
 * from the host App / Viewport publish. `mold_pull`, `sketch_undo`, and
 * `set_sketch_overlay` each answered `internal: … handler is missing` because
 * the Viewport published the handler but the bridge ctx never forwarded it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSurfcadBridge } from './agentBridge.js';

const here = dirname(fileURLToPath(import.meta.url));
const commandsDir = join(here, '..', 'agent', 'commands');
const bridgeSource = readFileSync(join(here, 'agentBridge.js'), 'utf8');

/** `ctx.name` reads across every non-test command module. */
function ctxFieldsUsedByCommands() {
  const names = new Set();
  for (const file of readdirSync(commandsDir)) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue;
    const src = readFileSync(join(commandsDir, file), 'utf8');
    for (const m of src.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  }
  return names;
}

/** Keys the bridge ctx literal defines (`name:` or shorthand `name,`). */
function ctxFieldsDefinedByBridge() {
  const start = bridgeSource.indexOf('\n  const ctx = {');
  assert.ok(start > 0, 'bridge ctx literal not found');
  const names = new Set();
  const body = bridgeSource.slice(start);
  for (const m of body.matchAll(/\n {4}([A-Za-z_$][\w$]*)\s*(?:[:(,]|\()/g)) names.add(m[1]);
  return names;
}

test('the bridge ctx forwards every handler a command reads', () => {
  const defined = ctxFieldsDefinedByBridge();
  const missing = [...ctxFieldsUsedByCommands()].filter((name) => !defined.has(name)).sort();
  assert.deepEqual(missing, [], `ctx fields read by commands but not defined by the bridge: ${missing.join(', ')}`);
});

test('mold_pull, sketch_undo, and set_sketch_overlay reach the host handlers', async () => {
  const calls = [];
  const api = createSurfcadBridge({
    getScript: () => '',
    moldPull: (args) => { calls.push(['moldPull', args]); return { mode: args.mode, plane: args.plane }; },
    agentSketchUndo: () => { calls.push(['agentSketchUndo']); return { ok: true, steps: 1 }; },
    setSketchOverlayVisible: (args) => { calls.push(['setSketchOverlayVisible', args]); return { enabled: args.enabled }; },
  });
  const pull = await api.call('mold_pull', JSON.stringify({ mode: 'plane', plane: 'top' }));
  assert.equal(pull.ok, true, JSON.stringify(pull));
  assert.deepEqual(pull.result, { mode: 'plane', plane: 'top' });
  const undo = await api.call('sketch_undo', '{}');
  assert.equal(undo.ok, true, JSON.stringify(undo));
  const overlay = await api.call('set_sketch_overlay', JSON.stringify({ enabled: false }));
  assert.equal(overlay.ok, true, JSON.stringify(overlay));
  assert.deepEqual(calls.map((c) => c[0]), ['moldPull', 'agentSketchUndo', 'setSketchOverlayVisible']);
});
