import assert from 'node:assert/strict';
import test from 'node:test';
import { PAINT_OPEN_WAIT_MS, createPaintMeasureAgentHandlers } from './paintMeasureAgentHost.js';

/** Fake clock: `wait` advances time instead of sleeping. */
function clock() {
  let t = 0;
  return { now: () => t, wait: async (ms) => { t += ms; } };
}

function host(overrides = {}) {
  const paintModeRef = { current: null };
  const enterCalls = [];
  const deps = {
    appMode: 'cad',
    paintModeRef,
    enterPaintModeRef: { current: () => { enterCalls.push(1); paintModeRef.current = { session: {} }; } },
    ...clock(),
    ...overrides,
  };
  return { handlers: createPaintMeasureAgentHandlers(deps), deps, paintModeRef, enterCalls };
}

test('paint_open opens at once when nothing blocks it', async () => {
  const { handlers, enterCalls } = host();
  assert.deepEqual(await handlers.paintOpen(), { result: { open: true } });
  assert.equal(enterCalls.length, 1);
  assert.deepEqual(await handlers.paintOpen(), { result: { open: true, already: true } });
});

test('paint_open waits for the gate to open, then opens', async () => {
  let blockedFor = 300;
  const { handlers, deps } = host({
    paintOpenBlocked: () => (deps.now() < blockedFor ? 'prompt_working' : null),
  });
  const out = await handlers.paintOpen();
  assert.deepEqual(out, { result: { open: true } });
  assert.ok(deps.now() >= 300 && deps.now() < PAINT_OPEN_WAIT_MS, `waited ${deps.now()} ms`);
  blockedFor = 0;
});

test('paint_open waits for the viewport to take the mode after a part switch', async () => {
  // The first enter calls are swallowed, as a settling part switch does.
  const paintModeRef = { current: null };
  let attempts = 0;
  const { handlers, deps } = host({
    paintModeRef,
    enterPaintModeRef: { current: () => { attempts += 1; if (attempts >= 4) paintModeRef.current = { session: {} }; } },
  });
  assert.deepEqual(await handlers.paintOpen(), { result: { open: true } });
  assert.equal(attempts, 4);
  assert.ok(deps.now() < PAINT_OPEN_WAIT_MS);
});

test('paint_open never answers open: false; past the wait it is a retryable not_ready error', async () => {
  const blocked = host({ paintOpenBlocked: () => 'prompt_working' });
  const out = await blocked.handlers.paintOpen();
  assert.equal(out.error.code, 'not_ready');
  assert.deepEqual(out.error.details, { reason: 'prompt_working', retryable: true });
  assert.match(out.error.message, /agent prompt is being worked/);
  assert.match(out.error.message, /Retry paint_open/);
  assert.ok(blocked.deps.now() >= PAINT_OPEN_WAIT_MS);
  assert.equal(blocked.enterCalls.length, 0);

  const swallowed = host({ enterPaintModeRef: { current: () => {} } });
  const late = await swallowed.handlers.paintOpen();
  assert.equal(late.error.code, 'not_ready');
  assert.equal(late.error.details.reason, 'mode_not_ready');
  assert.equal(late.error.details.retryable, true);
});

test('paint_open in game mode is bad_view without waiting', async () => {
  const { handlers, deps } = host({ appMode: 'game', paintOpenBlocked: () => 'prompt_working' });
  const out = await handlers.paintOpen();
  assert.equal(out.error.code, 'bad_view');
  assert.equal(deps.now(), 0);
});
