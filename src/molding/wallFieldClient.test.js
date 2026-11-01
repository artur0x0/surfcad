import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  copyWallMesh,
  dropWallJobs,
  requestWallField,
  resetWallFieldClientForTests,
} from './wallFieldClient.js';

class FakeWorker {
  constructor(url, options) {
    FakeWorker.latest = this;
    this.url = String(url);
    this.options = options;
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    this.posted = [];
  }

  postMessage(data, transfer) {
    this.posted.push({ data, transfer });
  }

  terminate() {
    this.terminated = true;
  }
}

test('copyWallMesh copies typed arrays and leaves the source buffer intact', () => {
  const positions = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = Uint32Array.from([0, 1, 2]);
  const triFace = Int32Array.from([0]);
  const source = positions.buffer;
  const copied = copyWallMesh(positions, indices, { triFace, normals: [[0, 0, 1]] });
  assert.equal(positions.buffer, source);
  assert.notEqual(copied.positions.buffer, source);
  assert.equal(copied.positions.constructor, Float64Array);
  assert.equal(copied.indices.constructor, Uint32Array);
  assert.equal(copied.stamped.triFace.constructor, Int32Array);
  assert.deepEqual(copied.stamped.normals, [[0, 0, 1]]);
  copied.positions[0] = 9;
  assert.equal(positions[0], 0);
});

test('requestWallField posts a copy and keeps the worker across requests', async () => {
  resetWallFieldClientForTests();
  const previous = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  try {
    const positions = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = Uint32Array.from([0, 1, 2]);
    let coarse = null;
    const pending = requestWallField({
      positions,
      indices,
      stamped: { triFace: Int32Array.from([0]), normals: [[0, 0, 1]] },
      onCoarse(result) { coarse = result; },
    });
    const worker = FakeWorker.latest;
    assert.equal(worker.options.type, 'module');
    assert.match(worker.url, /wallFieldWorker\.js$/);
    assert.equal(worker.posted.length, 1);
    const posted = worker.posted[0];
    assert.equal(posted.data.id, 1);
    assert.notEqual(posted.data.positions.buffer, positions.buffer);
    assert.equal(positions.length, 9);
    assert.ok(posted.transfer.includes(posted.data.positions.buffer));
    assert.ok(posted.transfer.includes(posted.data.indices.buffer));
    assert.ok(posted.transfer.includes(posted.data.stamped.triFace.buffer));

    worker.onmessage({ data: { id: 1, phase: 'coarse', result: { wall: { nominal: 2 } } } });
    assert.equal(coarse.wall.nominal, 2);
    worker.onmessage({ data: { id: 1, phase: 'done', result: { wall: { nominal: 2, max: 2 } } } });
    const done = await pending;
    assert.equal(done.wall.max, 2);

    const again = requestWallField({ positions, indices });
    assert.equal(FakeWorker.latest, worker);
    assert.equal(worker.terminated, false);
    dropWallJobs();
    const dropped = await again;
    assert.equal(dropped.dropped, true);
    worker.onmessage({ data: { id: 2, phase: 'done', result: { wall: { nominal: 9 } } } });
    assert.equal(dropped.dropped, true);

    const failing = requestWallField({ positions, indices });
    worker.onmessage({
      data: { id: 3, phase: 'error', error: { code: 'no_mesh', message: 'No mesh to score' } },
    });
    const failed = await failing;
    assert.equal(failed.error.code, 'no_mesh');

    const crashed = requestWallField({ positions, indices });
    worker.onerror({ message: 'worker exploded', preventDefault() {} });
    const crash = await crashed;
    assert.equal(crash.error.code, 'internal');
    assert.match(crash.error.message, /exploded/);
  } finally {
    resetWallFieldClientForTests();
    globalThis.Worker = previous;
  }
});

test('without Worker the plate is measured on this thread', async () => {
  resetWallFieldClientForTests();
  const previous = globalThis.Worker;
  globalThis.Worker = undefined;
  try {
    const positions = [
      0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0,
      0, 0, 2, 20, 0, 2, 20, 20, 2, 0, 20, 2,
    ];
    const indices = [
      0, 2, 1, 0, 3, 2,
      4, 5, 6, 4, 6, 7,
      1, 2, 6, 1, 6, 5,
      0, 4, 7, 0, 7, 3,
      3, 7, 6, 3, 6, 2,
      0, 1, 5, 0, 5, 4,
    ];
    const phases = [];
    const out = await requestWallField({
      positions,
      indices,
      onCoarse(coarse) { phases.push(coarse.wall.nominal); },
    });
    assert.equal(phases.length, 1);
    assert.ok(Math.abs(out.wall.nominal - 2) < 0.15, `nominal ${out.wall.nominal}`);
    assert.ok(out.wall.max < 3.2, `max ${out.wall.max}`);
  } finally {
    globalThis.Worker = previous;
  }
});

test('the viewport heatmap posts to the wall worker', () => {
  const view = readFileSync(new URL('../components/Viewport.jsx', import.meta.url), 'utf8');
  assert.match(view, /requestWallField\(/);
  assert.match(view, /requestMoldAnalysis\(/);
  assert.match(view, /dropWallJobs\(/);
  assert.match(view, /dropMoldJobs\(/);
  assert.doesNotMatch(view, /wallOnly:\s*true/);
  assert.doesNotMatch(view, /measureWallThickness/);
});
