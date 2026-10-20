/**
 * Geometry worker pool: the extra workers that build the parts that are
 * not active, in parallel, each in its own Manifold WASM instance.
 *
 * The primary worker (ManifoldContext.worker) stays the one the active part,
 * cross-sections, previews, exports, and the game run on, because those
 * read the solid that worker cached last. Pool jobs are stateless executes:
 * a script in, a mesh out. Members are spawned on demand up to `size`,
 * torn down after `idleMs` without work, and recycled after `recycleJobs`
 * jobs or once a run reports a heap past `recycleHeapMB`, so a long session
 * does not pile memory up in a worker nobody looks at. A member that
 * crashes handles its own restart (ManifoldWorker._onKernelCrash); the job
 * that crashed rejects with the structured error and the others go on.
 *
 * `createMember()` returns anything with `init()`, `execute(script, opts)`,
 * `terminate()`, and optionally `crashCount`, `lastHeapMB`, `isReady`. The
 * default is a `ManifoldWorker`. Tests pass a stand-in.
 */

export const POOL_RECYCLE_JOBS = 200;
export const POOL_RECYCLE_HEAP_MB = 1536;
export const POOL_IDLE_MS = 120000;

let nextMemberId = 1;

export function createGeometryPool(options = {}) {
  const createMember = options.createMember;
  if (typeof createMember !== 'function') throw new Error('createGeometryPool: createMember is required');
  let size = Math.max(0, Math.floor(Number(options.size) || 0));
  const recycleJobs = Number(options.recycleJobs) > 0 ? Number(options.recycleJobs) : POOL_RECYCLE_JOBS;
  const recycleHeapMB = Number(options.recycleHeapMB) > 0 ? Number(options.recycleHeapMB) : POOL_RECYCLE_HEAP_MB;
  const idleMs = Number(options.idleMs) >= 0 ? Number(options.idleMs) : POOL_IDLE_MS;
  const setTimer = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeout || ((t) => clearTimeout(t));

  /** @type {Array<{ id: number, member: object | null, ready: Promise<void> | null, busy: boolean, jobs: number, heapMB: number | null, recycled: number, idleTimer: any }>} */
  const slots = [];
  const queue = [];
  let jobsDone = 0;
  let jobsFailed = 0;
  let peakBusy = 0;
  let terminated = false;

  function busyCount() {
    return slots.filter((s) => s.busy).length;
  }

  function liveCount() {
    return slots.filter((s) => s.member).length;
  }

  function armIdle(slot) {
    if (slot.idleTimer) clearTimer(slot.idleTimer);
    slot.idleTimer = null;
    if (idleMs <= 0 || !slot.member) return;
    slot.idleTimer = setTimer(() => {
      slot.idleTimer = null;
      if (!slot.busy && slot.member) dropMember(slot);
    }, idleMs);
  }

  function dropMember(slot) {
    const member = slot.member;
    slot.member = null;
    slot.ready = null;
    slot.heapMB = null;
    slot.jobs = 0;
    if (slot.idleTimer) { clearTimer(slot.idleTimer); slot.idleTimer = null; }
    if (member) {
      try { member.terminate(); } catch (_) { /* gone */ }
    }
  }

  function ensureMember(slot) {
    if (slot.member) return slot.ready || Promise.resolve();
    const member = createMember(slot.id);
    slot.member = member;
    slot.ready = Promise.resolve(member.init ? member.init() : undefined).catch((err) => {
      if (slot.member === member) dropMember(slot);
      throw err;
    });
    return slot.ready;
  }

  function freeSlot() {
    return slots.find((s) => !s.busy && s.member) || slots.find((s) => !s.busy);
  }

  function dispatch() {
    if (terminated) return;
    while (queue.length) {
      const slot = freeSlot();
      if (!slot) return;
      const job = queue.shift();
      runOn(slot, job);
    }
  }

  async function runOn(slot, job) {
    slot.busy = true;
    peakBusy = Math.max(peakBusy, busyCount());
    if (slot.idleTimer) { clearTimer(slot.idleTimer); slot.idleTimer = null; }
    let result;
    let error = null;
    try {
      await ensureMember(slot);
      result = await slot.member.execute(job.script, job.options);
    } catch (err) {
      error = err;
    }
    slot.jobs += 1;
    const heap = Number(result?.wasmHeapMB ?? slot.member?.lastHeapMB);
    if (Number.isFinite(heap)) slot.heapMB = heap;
    slot.busy = false;
    if (error) {
      jobsFailed += 1;
      job.reject(error);
    } else {
      jobsDone += 1;
      job.resolve(result);
    }
    const tooManyJobs = slot.jobs >= recycleJobs;
    const tooMuchHeap = Number.isFinite(slot.heapMB) && slot.heapMB >= recycleHeapMB;
    if (slot.member && (tooManyJobs || tooMuchHeap)) {
      slot.recycled += 1;
      dropMember(slot);
    }
    if (slots.indexOf(slot) >= size) {
      // Shrunk while this job ran: let it go.
      dropMember(slot);
      slots.splice(slots.indexOf(slot), 1);
    } else {
      armIdle(slot);
    }
    dispatch();
  }

  function resize(n) {
    size = Math.max(0, Math.floor(Number(n) || 0));
    while (slots.length < size) {
      slots.push({ id: nextMemberId++, member: null, ready: null, busy: false, jobs: 0, heapMB: null, recycled: 0, idleTimer: null });
    }
    for (let i = slots.length - 1; i >= size; i -= 1) {
      if (!slots[i].busy) {
        dropMember(slots[i]);
        slots.splice(i, 1);
      }
    }
    dispatch();
  }

  resize(size);

  return {
    /** Extra workers this pool may hold (the primary is not one of them). */
    get size() { return size; },
    setSize: resize,
    /** Run a stateless execute on the next free member. */
    execute(script, options = {}) {
      if (terminated) return Promise.reject(new Error('geometry pool terminated'));
      if (size === 0) return Promise.reject(new Error('geometry pool has no workers'));
      return new Promise((resolve, reject) => {
        queue.push({ script, options, resolve, reject });
        dispatch();
      });
    },
    /** Drop idle members now (page hidden, memory pressure); busy ones finish first. */
    recycleIdle() {
      for (const slot of slots) if (!slot.busy && slot.member) dropMember(slot);
    },
    stats() {
      return {
        size,
        live: liveCount(),
        busy: busyCount(),
        queued: queue.length,
        peakBusy,
        jobsDone,
        jobsFailed,
        members: slots.map((s) => ({
          id: s.id,
          live: !!s.member,
          busy: s.busy,
          jobs: s.jobs,
          heapMB: s.heapMB,
          recycled: s.recycled,
          crashes: Number(s.member?.crashCount) || 0,
        })),
      };
    },
    terminate() {
      terminated = true;
      for (const job of queue.splice(0)) job.reject(new Error('geometry pool terminated'));
      for (const slot of slots) dropMember(slot);
      slots.length = 0;
    },
  };
}
