import assert from 'node:assert/strict';
import test from 'node:test';
import { ManifoldWorker } from './ManifoldWorker.js';
import { KERNEL_CRASH_CODE } from '../workers/kernelCrash.js';

/**
 * Crash isolation on the main thread, driven with a scripted stand-in for
 * the sandbox worker. The real protocol is loaded → init → ready, then
 * execute → result | error. A script containing CRASH makes the stand-in
 * report a fatal error the way runtime.js does after a wasm abort, HANG
 * never answers, DIE raises the worker's error event, and anything else
 * returns a small mesh.
 */

const MESH = { numProp: 3, vertProperties: [0, 0, 0, 1, 0, 0, 0, 1, 0], triVerts: [0, 1, 2], numRun: 1, runIndex: [0, 3], runOriginalID: [1] };

class FakeWorker {
  constructor(log) {
    this.log = log;
    this.listeners = new Set();
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    this.posted = [];
    this.dead = null;
    log.push({ event: 'spawn', worker: this });
    setTimeout(() => this._emit({ type: 'loaded' }), 0);
  }

  addEventListener(type, fn) { if (type === 'message') this.listeners.add(fn); }

  removeEventListener(type, fn) { if (type === 'message') this.listeners.delete(fn); }

  terminate() { this.terminated = true; this.log.push({ event: 'terminate', worker: this }); }

  _emit(data) {
    if (this.terminated) return;
    const event = { data };
    for (const fn of [...this.listeners]) fn(event);
    if (this.onmessage) this.onmessage(event);
  }

  postMessage(message) {
    this.posted.push(message);
    if (this.terminated) return;
    const { type, id, payload } = message;
    if (this.dead) {
      setTimeout(() => this._emit({ type: 'error', id, payload: { ...this.dead, dead: true, fatal: true } }), 0);
      return;
    }
    if (type === 'init') { setTimeout(() => this._emit({ type: 'ready', id }), 0); return; }
    if (type === 'ping') { setTimeout(() => this._emit({ type: 'result', id, payload: { ok: true } }), 0); return; }
    if (type !== 'execute') { setTimeout(() => this._emit({ type: 'result', id, payload: {} }), 0); return; }
    const script = String(payload.script);
    if (script.includes('HANG')) return;
    if (script.includes('DIE')) {
      setTimeout(() => { if (this.onerror) this.onerror({ message: 'Uncaught RuntimeError: Aborted()' }); }, 0);
      return;
    }
    if (script.includes('CRASH')) {
      this.dead = { message: 'Aborted(). Build with -sASSERTIONS for more info.', name: 'RuntimeError', reason: 'out_of_memory', wasmHeapMB: 4096 };
      setTimeout(() => this._emit({ type: 'error', id, payload: { ...this.dead, fatal: true } }), 0);
      return;
    }
    if (script.includes('THROW')) {
      setTimeout(() => this._emit({ type: 'error', id, payload: { message: 'cut: plane needs a normal', name: 'Error' } }), 0);
      return;
    }
    const delay = /DELAY(\d+)/.exec(script);
    setTimeout(() => this._emit({
      type: 'result',
      id,
      payload: { mesh: MESH, volume: 1, surfaceArea: 6, status: 'NoError', tris: 1, boundingBox: { min: [0, 0, 0], max: [1, 1, 0] }, bodyCentroids: [[0, 0, 0]], timing: { execMs: 1, serializeMs: 0 }, echo: script },
    }), delay ? Number(delay[1]) : 0);
  }
}

function harness() {
  const log = [];
  const crashes = [];
  const mw = new ManifoldWorker({ createWorker: () => new FakeWorker(log), onCrash: (info) => crashes.push(info) });
  return { mw, log, crashes, workers: () => log.filter((e) => e.event === 'spawn').map((e) => e.worker) };
}

test('a fatal report fails that job with the structured error, replaces the worker, and re-posts the queued job', async () => {
  const { mw, crashes, workers } = harness();
  await mw.init();
  const first = workers()[0];
  const crashing = mw.execute('CRASH', { partId: 'p12' });
  const queued = mw.execute('return cube; // queued behind');
  const t0 = Date.now();
  const err = await crashing.then(() => null, (e) => e);
  assert.ok(err, 'the crashing job rejects');
  assert.equal(err.code, KERNEL_CRASH_CODE);
  assert.equal(err.reason, 'out_of_memory');
  assert.equal(err.workerRestarted, true);
  assert.equal(err.partId, 'p12');
  assert.equal(err.wasmHeapMB, 4096);
  assert.match(err.message, /ran out of memory.*restarted.*other parts are unaffected/);
  assert.ok(Date.now() - t0 < 2000, 'fails fast');
  const result = await queued;
  assert.equal(result.echo, 'return cube; // queued behind');
  assert.equal(first.terminated, true);
  assert.equal(workers().length, 2);
  assert.notEqual(mw.worker, first);
  assert.equal(mw.isReady, true);
  assert.equal(mw.crashCount, 1);
  assert.equal(crashes.length, 1);
  assert.equal(crashes[0].reason, 'out_of_memory');
  assert.equal(crashes[0].failed, 1);
  assert.equal(crashes[0].requeued, 1);
  // The next job runs on the fresh worker without a reload.
  const next = await mw.execute('return cube; // after');
  assert.equal(next.echo, 'return cube; // after');
  assert.equal(workers().length, 2);
});

test('a job past its budget is killed: timeout error, fresh worker, later jobs unaffected', async () => {
  const { mw, workers } = harness();
  await mw.init();
  const hung = mw.execute('HANG', { timeoutMs: 60 });
  const later = mw.execute('return cube; // later', { timeoutMs: 5000 });
  const t0 = Date.now();
  const err = await hung.then(() => null, (e) => e);
  assert.equal(err.code, KERNEL_CRASH_CODE);
  assert.equal(err.reason, 'timeout');
  assert.equal(err.budgetMs, 60);
  assert.match(err.message, /did not finish within 0 s|did not finish within/);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal((await later).echo, 'return cube; // later');
  assert.equal(workers().length, 2);
  assert.equal(workers()[0].terminated, true);
  assert.equal(mw.lastCrash.reason, 'timeout');
});

test('a worker error event with no report counts as the running job crashing', async () => {
  const { mw, workers } = harness();
  await mw.init();
  const dying = mw.execute('DIE');
  const err = await dying.then(() => null, (e) => e);
  assert.equal(err.code, KERNEL_CRASH_CODE);
  assert.equal(err.reason, 'wasm_abort');
  assert.equal(workers().length, 2);
  assert.equal((await mw.execute('return cube;')).echo, 'return cube;');
});

test('an ordinary script error is not a crash: same worker, plain rejection', async () => {
  const { mw, workers, crashes } = harness();
  await mw.init();
  const err = await mw.execute('THROW').then(() => null, (e) => e);
  assert.equal(err.message, 'cut: plane needs a normal');
  assert.equal(err.code, undefined);
  assert.equal(workers().length, 1);
  assert.equal(workers()[0].terminated, false);
  assert.equal(crashes.length, 0);
  assert.equal(mw.crashCount, 0);
});

test('a second report from the dead thread does not start a second restart', async () => {
  const { mw, workers } = harness();
  await mw.init();
  const a = mw.execute('CRASH');
  const b = mw.execute('CRASH too');
  const ea = await a.then(() => null, (e) => e);
  assert.equal(ea.code, KERNEL_CRASH_CODE);
  // b was queued behind a: it is re-posted to the new worker, where it also crashes.
  const eb = await b.then(() => null, (e) => e);
  assert.equal(eb.code, KERNEL_CRASH_CODE);
  assert.equal(workers().length, 3);
  assert.equal(mw.crashCount, 2);
  assert.equal((await mw.execute('return cube;')).echo, 'return cube;');
});

test('the budget for a normal job is not the watchdog: a slow job inside its budget completes', async () => {
  const { mw, workers } = harness();
  await mw.init();
  const slow = await mw.execute('DELAY30', { timeoutMs: 1000 });
  assert.equal(slow.echo, 'DELAY30');
  assert.equal(workers().length, 1);
});

/**
 * Per-block budget. The stand-in reports which marked block it is in
 * (`PROGRESS:<id>` in the script posts a featureProgress message the way the
 * worker's tracker does), then hangs. On the re-post, `payload.timedOut`
 * names that block and the stand-in answers with the recovered mesh and the
 * feature-skip report runtime.js would build; `HANGALWAYS` keeps hanging.
 */
class BlockWorker extends FakeWorker {
  postMessage(message) {
    const { type, id, payload } = message;
    if (type !== 'execute' || this.terminated || this.dead) return super.postMessage(message);
    const script = String(payload.script);
    const progress = payload.progress === true ? /PROGRESS:([\w-]+)/.exec(script) : null;
    if (!progress) return super.postMessage(message);
    this.posted.push(message);
    const timedOut = Array.isArray(payload.timedOut) ? payload.timedOut : [];
    setTimeout(() => this._emit({
      type: 'featureProgress', id, payload: { featureId: progress[1], kind: 'chamfer', label: 'Chamfer', index: 1, block: '// --- chamfer begin ---' },
    }), 0);
    if (script.includes('HANGALWAYS')) return undefined;
    if (!timedOut.some((row) => row.id === progress[1])) return undefined;
    setTimeout(() => this._emit({
      type: 'result',
      id,
      payload: {
        mesh: MESH, volume: 1, surfaceArea: 6, status: 'NoError', tris: 1, boundingBox: { min: [0, 0, 0], max: [1, 1, 0] }, bodyCentroids: [[0, 0, 0]], timing: { execMs: 1, serializeMs: 0 },
        echo: script,
        timedOut,
        featureSkip: { featureId: progress[1], featureBlock: '// --- chamfer begin ---', scriptLine: null, message: `Chamfer did not finish within the 0 s budget`, skipped: [], code: 'feature_timeout', timeout: timedOut[0], hint: 'fewer edges' },
        featureTimings: [{ id: 'cube1', kind: 'cube', ms: 2 }],
      },
    }), 0);
    return undefined;
  }
}

/** A base cube block, then a hole block carrying `marker` as its body. */
const blockScript = (marker, holeId = 'hole1') => [
  '// --- cube begin id=cube1 ---',
  'let part = Manifold.cube([10, 10, 10], true);',
  '// --- cube end ---',
  `// --- hole begin id=${holeId} ---`,
  marker,
  '// --- hole end ---',
  'return part;',
  '',
].join('\n');

function blockHarness() {
  const log = [];
  const crashes = [];
  const mw = new ManifoldWorker({ createWorker: () => new BlockWorker(log), onCrash: (info) => crashes.push(info) });
  return { mw, log, crashes, workers: () => log.filter((e) => e.event === 'spawn').map((e) => e.worker) };
}

test('a job killed inside a marked block is re-posted without that block and resolves with a feature_timeout report', async () => {
  const { mw, workers, crashes } = blockHarness();
  await mw.init();
  const hung = mw.execute(blockScript('PROGRESS:hole1 HANG'), { timeoutMs: 60 });
  const later = mw.execute('return cube; // later', { timeoutMs: 5000 });
  const result = await hung;
  assert.equal(result.featureSkip.code, 'feature_timeout');
  assert.equal(result.featureSkip.featureId, 'hole1');
  assert.equal(result.timedOut.length, 1);
  assert.equal(result.timedOut[0].id, 'hole1');
  assert.equal(result.timedOut[0].kind, 'chamfer');
  assert.equal(result.timedOut[0].budgetMs, 60);
  assert.ok(result.timedOut[0].elapsedMs >= 0 && result.timedOut[0].elapsedMs < 2000, String(result.timedOut[0].elapsedMs));
  assert.deepEqual(result.featureTimings, [{ id: 'cube1', kind: 'cube', ms: 2 }]);
  // One crash, one restart, the hung job re-posted to the fresh worker with
  // the block named (the stand-in answered the later job before the crash,
  // so nothing was queued behind it).
  assert.equal(workers().length, 2);
  assert.equal(workers()[0].terminated, true);
  const reposted = workers()[1].posted.filter((m) => m.type === 'execute');
  assert.equal(reposted.length, 1);
  assert.match(String(reposted[0].payload.script), /PROGRESS:hole1/);
  assert.deepEqual(reposted[0].payload.timedOut.map((r) => r.id), ['hole1']);
  assert.equal((await later).echo, 'return cube; // later');
  assert.equal(mw.crashCount, 1);
  assert.equal(mw.lastCrash.retried, 1);
  assert.equal(mw.lastCrash.failed, 0);
  assert.equal(mw.lastCrash.featureId, 'hole1');
  assert.equal(crashes.length, 1);
});

test('a timed-out block whose removal would leave no solid is not re-posted: the part fails as before, naming the block', async () => {
  const { mw, workers } = blockHarness();
  await mw.init();
  // A freehand script is one code block; skipping it leaves nothing.
  const whole = ['// --- code begin id=code-0 ---', 'let part = Manifold.cube([10, 10, 10], true);', 'PROGRESS:code-0 HANG', '// --- code end ---', 'return part;', ''].join('\n');
  const err = await mw.execute(whole, { timeoutMs: 40 }).then(() => null, (e) => e);
  assert.equal(err.code, KERNEL_CRASH_CODE);
  assert.equal(err.reason, 'timeout');
  assert.equal(err.featureId, 'code-0');
  assert.match(err.message, /did not finish within 0 s, and the part still had no solid without it/);
  assert.equal(workers().length, 2);
  assert.equal(mw.lastCrash.retried, 0);
  assert.equal(mw.lastCrash.failed, 1);
  // The base block of a two-block part is the same: everything depends on it.
  const base = blockScript('part = part.subtract(Manifold.cylinder(12, 2, 2, 12, true));').replace('let part = Manifold.cube([10, 10, 10], true);', 'PROGRESS:cube1 HANG');
  const err2 = await mw.execute(base, { timeoutMs: 40 }).then(() => null, (e) => e);
  assert.equal(err2.code, KERNEL_CRASH_CODE);
  assert.equal(err2.featureId, 'cube1');
  assert.equal(mw.lastCrash.retried, 0);
});

test('the re-post is bounded: a block that never finishes fails the job as a crash that names the block', async () => {
  const { mw, workers } = blockHarness();
  await mw.init();
  const err = await mw.execute(blockScript('PROGRESS:fillet1 HANGALWAYS', 'fillet1'), { timeoutMs: 40 }).then(() => null, (e) => e);
  assert.equal(err.code, KERNEL_CRASH_CODE);
  assert.equal(err.reason, 'timeout');
  assert.equal(err.featureId, 'fillet1');
  assert.equal(err.featureKind, 'chamfer');
  assert.match(err.message, /Chamfer did not finish within 0 s, and the part still had no solid without it/);
  // The first kill plus MAX_FEATURE_TIMEOUT_RETRIES re-posts, each a fresh worker.
  assert.equal(mw.crashCount, 4);
  assert.equal(workers().length, 5);
  const last = workers()[3].posted.find((m) => m.type === 'execute');
  assert.equal(last.payload.timedOut.length, 3);
  assert.ok(last.payload.timedOut.every((r) => r.id === 'fillet1'));
});

test('a timeout outside every block fails as before, with no re-post', async () => {
  const { mw, workers } = blockHarness();
  await mw.init();
  const err = await mw.execute('HANG', { timeoutMs: 40 }).then(() => null, (e) => e);
  assert.equal(err.code, KERNEL_CRASH_CODE);
  assert.equal(err.featureId, undefined);
  assert.equal(workers().length, 2);
  assert.equal(mw.lastCrash.retried, 0);
  assert.equal(mw.lastCrash.failed, 1);
});
