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

test('the wall worker posts a coarse field and then the refined field', () => {
  const posted = [];
  const previous = globalThis.postMessage;
  globalThis.postMessage = (data) => { posted.push(data); };
  try {
    globalThis.onmessage({ data: plate() });
    assert.equal(posted.length, 2);
    assert.equal(posted[0].id, 4);
    assert.equal(posted[0].phase, 'coarse');
    assert.equal(posted[1].phase, 'done');
    assert.ok(Math.abs(posted[0].result.wall.nominal - 2) < 0.15);
    assert.ok(posted[1].result.wall.max < 3.2, `max ${posted[1].result.wall.max}`);
    assert.equal(posted[0].result.wall.field[0].source === 'ray'
      || posted[0].result.wall.field[0].source === 'sphere', true);
  } finally {
    globalThis.postMessage = previous;
  }
});

test('the wall worker posts an error and skips the refined pass on an empty mesh', () => {
  const posted = [];
  const previous = globalThis.postMessage;
  globalThis.postMessage = (data) => { posted.push(data); };
  try {
    globalThis.onmessage({ data: { id: 5, positions: new Float64Array(), indices: new Uint32Array() } });
    assert.equal(posted.length, 1);
    assert.equal(posted[0].phase, 'error');
    assert.equal(posted[0].error.code, 'no_mesh');
  } finally {
    globalThis.postMessage = previous;
  }
});
