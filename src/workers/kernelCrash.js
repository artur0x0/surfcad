/**
 * Kernel crash contract, shared by the sandbox worker and the main thread.
 *
 * A Manifold WASM abort (`Aborted()`, a trap, out of memory) leaves the
 * module unusable: every later kernel call throws or never returns, and
 * before this the tab had to be reloaded. The worker classifies the throw
 * (`classifyKernelFailure`) and marks itself dead; the main thread turns
 * the report, a worker `error` event, or a watchdog timeout into one
 * structured error (`kernelCrashError`), terminates the worker, starts a
 * fresh one, fails the job that crashed, and re-posts the jobs that were
 * queued behind it (`splitPendingOnCrash`).
 */

export const KERNEL_CRASH_CODE = 'geometry_worker_crashed';

/** The wasm heap cap of the shipped build (32-bit addressing). */
export const WASM_HEAP_CAP_MB = 4096;

/** A heap this close to the cap at the abort means the allocator gave up. */
const OOM_HEAP_FRACTION = 0.875;

const ABORT_RE = /\bAborted\b|\bunreachable\b|memory access out of bounds|table index is out of bounds|null function or function signature mismatch|indirect call signature mismatch|wasm trap/i;
const OOM_RE = /out of memory|OOM\b|Cannot enlarge memory|allocation failed|memory\.grow|RangeError: WebAssembly\.Memory/i;

/** Milliseconds a job may run before the watchdog treats it as a crash. */
export const DEFAULT_JOB_BUDGET_MS = 30000;

/**
 * Is this throw the kernel dying (rather than a script or helper error),
 * and why. `heapMB` is the wasm heap at the time; `capMB` its maximum.
 *
 * @param {{ error?: unknown, name?: string, message?: string, heapMB?: number | null, capMB?: number }} input
 * @returns {{ fatal: boolean, reason: 'wasm_abort' | 'out_of_memory' | null }}
 */
export function classifyKernelFailure(input = {}) {
  const error = input.error;
  const name = typeof input.name === 'string' ? input.name
    : (error && typeof error === 'object' && typeof error.name === 'string' ? error.name : '');
  const message = typeof input.message === 'string' ? input.message
    : (error && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error ?? ''));
  const heapMB = Number(input.heapMB);
  const capMB = Number(input.capMB) > 0 ? Number(input.capMB) : WASM_HEAP_CAP_MB;
  const RuntimeError = typeof WebAssembly !== 'undefined' ? WebAssembly.RuntimeError : null;
  const isTrap = (RuntimeError && error instanceof RuntimeError) || name === 'RuntimeError';
  const oomText = OOM_RE.test(message);
  const abortText = ABORT_RE.test(message);
  if (!isTrap && !oomText && !abortText) return { fatal: false, reason: null };
  const heapFull = Number.isFinite(heapMB) && heapMB >= OOM_HEAP_FRACTION * capMB;
  return { fatal: true, reason: oomText || heapFull ? 'out_of_memory' : 'wasm_abort' };
}

/** One line the user and the agent both read. */
export function kernelCrashMessage({ reason, budgetMs, kernelMessage, wasmHeapMB } = {}) {
  const heap = Number.isFinite(Number(wasmHeapMB)) ? ` (heap ${Math.round(Number(wasmHeapMB))} MB)` : '';
  if (reason === 'out_of_memory') {
    return `The geometry engine ran out of memory building this part${heap}. It was restarted; other parts are unaffected. Simplify the part, lower segment counts, or split it up.`;
  }
  if (reason === 'timeout') {
    const seconds = Number.isFinite(Number(budgetMs)) ? `${Math.round(Number(budgetMs) / 1000)} s` : 'its time budget';
    return `This part did not finish within ${seconds}. The geometry engine was restarted; other parts are unaffected. Simplify the part, lower segment counts, or split it up.`;
  }
  if (reason === 'worker_lost') {
    return 'The geometry engine stopped while building this part. It was restarted; other parts are unaffected. Run the part again, and simplify it if this repeats.';
  }
  const why = typeof kernelMessage === 'string' && kernelMessage.trim() ? ` (${kernelMessage.trim().split('\n')[0].slice(0, 80)})` : '';
  return `The geometry engine crashed building this part${why}. It was restarted; other parts are unaffected. Simplify the part, lower segment counts, or split it up.`;
}

/** The `detail` an agent error row carries for every crash. */
export const KERNEL_CRASH_DETAIL = 'The geometry worker was restarted and other parts kept building. Simplify this part, reduce segment counts, or split it into smaller parts before running it again.';

/**
 * Build the error the failed job rejects with.
 *
 * @param {{
 *   reason: 'wasm_abort' | 'out_of_memory' | 'timeout' | 'worker_lost',
 *   kernelMessage?: string,
 *   wasmHeapMB?: number | null,
 *   budgetMs?: number,
 *   partId?: string | null,
 *   featureId?: string | null,
 *   workerRestarted?: boolean,
 * }} info
 */
export function kernelCrashError(info = {}) {
  const reason = info.reason || 'wasm_abort';
  const error = new Error(kernelCrashMessage({ ...info, reason }));
  error.name = 'KernelCrashError';
  error.code = KERNEL_CRASH_CODE;
  error.reason = reason;
  error.workerRestarted = info.workerRestarted !== false;
  if (typeof info.kernelMessage === 'string' && info.kernelMessage) error.kernelMessage = info.kernelMessage;
  if (Number.isFinite(Number(info.wasmHeapMB))) error.wasmHeapMB = Number(info.wasmHeapMB);
  if (Number.isFinite(Number(info.budgetMs))) error.budgetMs = Number(info.budgetMs);
  if (typeof info.partId === 'string' && info.partId) error.partId = info.partId;
  if (typeof info.featureId === 'string' && info.featureId) error.featureId = info.featureId;
  return error;
}

export function isKernelCrashError(error) {
  return !!error && typeof error === 'object' && error.code === KERNEL_CRASH_CODE;
}

/** The JSON-safe crash record a run outcome, a part run, or an error row carries. */
export function kernelCrashRecord(error) {
  if (!isKernelCrashError(error)) return null;
  const out = {
    code: KERNEL_CRASH_CODE,
    reason: error.reason || 'wasm_abort',
    workerRestarted: error.workerRestarted !== false,
    message: error.message,
  };
  if (typeof error.kernelMessage === 'string') out.kernelMessage = error.kernelMessage;
  if (Number.isFinite(error.wasmHeapMB)) out.wasmHeapMB = error.wasmHeapMB;
  if (Number.isFinite(error.budgetMs)) out.budgetMs = error.budgetMs;
  if (typeof error.partId === 'string') out.partId = error.partId;
  if (typeof error.featureId === 'string') out.featureId = error.featureId;
  return out;
}

/**
 * The worker answers messages in order, so when one job kills it, every
 * job posted before it had already been answered and every job posted
 * after it never ran. The crashed job (and anything older that is somehow
 * still pending) fails; the newer ones are re-posted to the fresh worker.
 * With no id (a worker `error` event, a watchdog with no job) the oldest
 * pending job is the one that was running.
 *
 * @param {string[]} pendingIds in post order
 * @param {string | null} crashedId
 * @returns {{ failed: string[], requeue: string[] }}
 */
export function splitPendingOnCrash(pendingIds, crashedId = null) {
  const ids = Array.isArray(pendingIds) ? pendingIds.filter((id) => id != null) : [];
  if (!ids.length) return { failed: [], requeue: [] };
  let at = crashedId != null ? ids.indexOf(crashedId) : 0;
  if (at < 0) at = 0;
  return { failed: ids.slice(0, at + 1), requeue: ids.slice(at + 1) };
}
