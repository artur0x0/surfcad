import assert from 'node:assert/strict';
import test from 'node:test';
import './wallFieldWorker.js';

function plate() {
  return {
    id: 4,
    positions: Float64Array.from([
      0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0,
      0, 0, 2, 20, 0, 2, 20, 20, 2, 0, 20, 2,
    ]),
    indices: Uint32Array.from([
      0, 2, 1, 0, 3, 2,
      4, 5, 6, 4, 6, 7,
      1, 2, 6, 1, 6, 5,
      0, 4, 7, 0, 7, 3,
      3, 7, 6, 3, 6, 2,
      0, 1, 5, 0, 5, 4,
    ]),
  };
}

function settle() {
  return new Promise((resolve) => {
    setTimeout(resolve, 40);
  });
}

test('the wall worker posts a coarse field and then the refined field', async () => {
  const posted = [];
  const previous = globalThis.postMessage;
  globalThis.postMessage = (data) => { posted.push(data); };
  try {
    globalThis.onmessage({ data: plate() });
    await settle();
    const coarse = posted.find((row) => row.phase === 'coarse');
    const done = posted.find((row) => row.phase === 'done');
    assert.ok(coarse);
    assert.equal(coarse.id, 4);
    assert.ok(done);
    assert.ok(posted.some((row) => row.phase === 'progress' && row.stage === 'Wall thickness'));
    assert.ok(Math.abs(coarse.result.wall.nominal - 2) < 0.15);
    assert.ok(done.result.wall.max < 3.2, `max ${done.result.wall.max}`);
    assert.equal(coarse.result.wall.field[0].source === 'ray'
      || coarse.result.wall.field[0].source === 'sphere', true);
  } finally {
    globalThis.postMessage = previous;
  }
});

test('the wall worker posts an error and skips the refined pass on an empty mesh', async () => {
  const posted = [];
  const previous = globalThis.postMessage;
  globalThis.postMessage = (data) => { posted.push(data); };
  try {
    globalThis.onmessage({ data: { id: 5, positions: new Float64Array(), indices: new Uint32Array() } });
    await settle();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].phase, 'error');
    assert.equal(posted[0].error.code, 'no_mesh');
  } finally {
    globalThis.postMessage = previous;
  }
});

test('a cancel before the wall pass drops the job', async () => {
  const posted = [];
  const previous = globalThis.postMessage;
  globalThis.postMessage = (data) => { posted.push(data); };
  try {
    globalThis.onmessage({ data: { ...plate(), id: 6 } });
    globalThis.onmessage({ data: { cancel: 6 } });
    await settle();
    assert.equal(posted.some((row) => row.phase === 'done'), false);
    assert.ok(posted.some((row) => row.phase === 'dropped' && row.id === 6));
  } finally {
    globalThis.postMessage = previous;
  }
});
