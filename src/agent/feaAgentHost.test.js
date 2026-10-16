/** feaAgentHost wait-loop and timeout behaviour. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFeaAgentHandlers } from './feaAgentHost.js';

test('feaRun times out when tet10 finishes without stats', async () => {
  const panel = {
    open: true,
    running: false,
    runReport: { status: 'done' },
    result: { source: 'tet10', max: 1, p95: 1, stats: null },
    run: async () => {},
  };
  const panelRef = { current: panel };
  const handlers = createFeaAgentHandlers({
    panelRef,
    runTimeoutMs: 0,
    runPollMs: 0,
    sleep: async () => {},
  });
  const out = await handlers.feaRun();
  assert.equal(out.error?.code, 'timeout');
  assert.equal(out.error?.message, 'stats not available');
  assert.equal(out.result, undefined);
});
