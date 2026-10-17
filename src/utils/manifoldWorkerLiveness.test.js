import assert from 'node:assert/strict';
import { test } from 'node:test';
import { softRestartDecision } from './manifoldWorkerLiveness.js';

test('a script still in flight is busy, not a dead worker', () => {
  assert.equal(softRestartDecision({ pendingWork: 1, pingOk: false }), 'busy');
  assert.equal(softRestartDecision({ pendingWork: 2 }), 'busy');
});

test('init or an in-flight restart is not another restart', () => {
  assert.equal(softRestartDecision({ initInFlight: true, pingOk: false }), 'starting');
  assert.equal(softRestartDecision({ restartInFlight: true, pendingWork: 1 }), 'wait');
});

test('an idle worker restarts only when ping fails', () => {
  assert.equal(softRestartDecision({ pendingWork: 0 }), 'ping');
  assert.equal(softRestartDecision({ pendingWork: 0, pingOk: true }), 'alive');
  assert.equal(softRestartDecision({ pendingWork: 0, pingOk: false }), 'restart');
});

test('work that starts during the ping still blocks the restart', () => {
  assert.equal(softRestartDecision({ pendingWork: 1, pingOk: false }), 'busy');
});
