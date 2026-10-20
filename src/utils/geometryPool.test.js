import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeometryPool } from './geometryPool.js';

/** A stand-in member: resolves after the delay the script names (`D<ms>`), fails on FAIL. */
function fakeMembers(log = []) {
  return (id) => {
    const member = {
      id,
      inited: false,
      terminated: false,
      running: 0,
      crashCount: 0,
      lastHeapMB: 40,
      async init() { member.inited = true; log.push(`init ${id}`); },
      async execute(script, options = {}) {
        member.running += 1;
        const ms = Number(/D(\d+)/.exec(script)?.[1] || 0);
        await new Promise((r) => setTimeout(r, ms));
        member.running -= 1;
        if (/FAIL/.test(script)) { member.crashCount += 1; throw Object.assign(new Error('crashed'), { code: 'geometry_worker_crashed' }); }
        const heap = Number(/HEAP(\d+)/.exec(script)?.[1] || 40);
        return { script, member: id, partId: options.partId, wasmHeapMB: heap };
      },
      terminate() { member.terminated = true; log.push(`terminate ${id}`); },
    };
    return member;
  };
}

test('jobs run in parallel up to the pool size and queue beyond it', async () => {
  const log = [];
  const pool = createGeometryPool({ size: 3, createMember: fakeMembers(log), idleMs: 0 });
  const t0 = Date.now();
  const results = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => pool.execute(`D40 job${i}`, { partId: `p${i}` })));
  const ms = Date.now() - t0;
  assert.equal(results.length, 6);
  assert.deepEqual(results.map((r) => r.partId), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  const stats = pool.stats();
  assert.equal(stats.size, 3);
  assert.equal(stats.peakBusy, 3);
  assert.equal(stats.jobsDone, 6);
  assert.equal(stats.live, 3);
  assert.ok(ms < 40 * 6, `took ${ms} ms, not serial`);
  assert.ok(ms >= 80, `took ${ms} ms: two rounds of 40 ms`);
  pool.terminate();
  assert.equal(log.filter((l) => l.startsWith('terminate')).length, 3);
});

test('a job that fails on one member rejects alone; the others complete and the member is reused', async () => {
  const pool = createGeometryPool({ size: 2, createMember: fakeMembers(), idleMs: 0 });
  const [a, b, c] = await Promise.allSettled([
    pool.execute('D10 FAIL', { partId: 'bad' }),
    pool.execute('D10 ok', { partId: 'good' }),
    pool.execute('D5 ok too', { partId: 'later' }),
  ]);
  assert.equal(a.status, 'rejected');
  assert.equal(a.reason.code, 'geometry_worker_crashed');
  assert.equal(b.status, 'fulfilled');
  assert.equal(c.status, 'fulfilled');
  const stats = pool.stats();
  assert.equal(stats.jobsFailed, 1);
  assert.equal(stats.jobsDone, 2);
  assert.equal(stats.members.reduce((n, m) => n + m.crashes, 0), 1);
  pool.terminate();
});

test('a member is recycled after the job count or a heap past the threshold', async () => {
  const log = [];
  const pool = createGeometryPool({ size: 1, createMember: fakeMembers(log), idleMs: 0, recycleJobs: 3, recycleHeapMB: 1000 });
  await pool.execute('a');
  await pool.execute('b');
  assert.equal(pool.stats().members[0].jobs, 2);
  await pool.execute('c');
  assert.equal(pool.stats().members[0].live, false, 'dropped after the third job');
  assert.equal(pool.stats().members[0].recycled, 1);
  await pool.execute('HEAP1600 big');
  assert.equal(pool.stats().members[0].live, false, 'dropped after a fat heap');
  assert.equal(pool.stats().members[0].recycled, 2);
  await pool.execute('small');
  assert.equal(pool.stats().members[0].live, true);
  assert.equal(log.filter((l) => l.startsWith('init')).length, 3);
  pool.terminate();
});

test('an idle member is torn down after idleMs and spawned again on the next job', async () => {
  const log = [];
  const pool = createGeometryPool({ size: 1, createMember: fakeMembers(log), idleMs: 20 });
  await pool.execute('one');
  assert.equal(pool.stats().live, 1);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(pool.stats().live, 0);
  await pool.execute('two');
  assert.equal(pool.stats().live, 1);
  assert.equal(log.filter((l) => l.startsWith('init')).length, 2);
  pool.terminate();
});

test('setSize grows and shrinks; a size of zero refuses jobs', async () => {
  const pool = createGeometryPool({ size: 0, createMember: fakeMembers(), idleMs: 0 });
  await assert.rejects(pool.execute('x'), /no workers/);
  pool.setSize(2);
  const both = await Promise.all([pool.execute('D10 a'), pool.execute('D10 b')]);
  assert.equal(new Set(both.map((r) => r.member)).size, 2);
  assert.equal(pool.stats().live, 2);
  pool.setSize(1);
  assert.equal(pool.stats().size, 1);
  assert.equal(pool.stats().live, 1);
  pool.recycleIdle();
  assert.equal(pool.stats().live, 0);
  pool.terminate();
  await assert.rejects(pool.execute('x'), /terminated/);
});
