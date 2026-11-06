/**
 * Long mold analyses answer a heartbeat instead of holding the call.
 *
 * `mold_fit` on a real part (20k triangles and up) runs for a minute or
 * more in the analysis worker. One tool call that long looks like silence
 * to an agent: its host gives up, the relay calls the tab asleep, or the
 * agent moves on. So a `mold_*` call waits `AGENT_MOLD_WAIT_MS` (about
 * 30 s) and, when the analysis is still going, answers
 *
 *   { status: 'running', stillRunning: true, jobId, command,
 *     phase?, percent?, elapsedSec, etaSec?, message }
 *
 * That is a heartbeat, never a result: it carries no fit, wall or report
 * fields. `mold_status { job_id }` waits up to the same budget and answers
 * the next heartbeat or, once the analysis finishes, exactly what the
 * original call would have returned (plus `jobId`). The analysis keeps
 * running in between; nothing is restarted. An analysis that finishes
 * inside the budget answers its result directly, as before.
 *
 * Same shape as git_save / git_save_status (commands/git.js). Tests shorten
 * the budget through `globalThis.__SURFCAD_AGENT_MOLD_WAIT_MS`.
 */

export const AGENT_MOLD_WAIT_MS = 30_000;
/** Finished jobs stay readable this long after they end. */
const JOB_RECORD_TTL_MS = 10 * 60_000;

function waitMs() {
  const override = Number(globalThis.__SURFCAD_AGENT_MOLD_WAIT_MS);
  return Number.isFinite(override) && override >= 0 ? override : AGENT_MOLD_WAIT_MS;
}

/** jobId -> { jobId, command, startedAt, done, finishedAt, outcome, settled, readProgress } */
const jobs = new Map();
let jobSeq = 0;

function pruneJobs(now = Date.now()) {
  for (const [id, entry] of jobs) {
    if (entry.done && now - entry.finishedAt > JOB_RECORD_TTL_MS) jobs.delete(id);
  }
}

/** Test hook: forget every recorded job. */
export function _resetMoldJobs() {
  jobs.clear();
}

export const MOLD_RUNNING_MESSAGE = 'Still running. This is a heartbeat, not the result: call mold_status { job_id } (it waits up to about 30 s) until it answers the result. Keep the SurfCAD tab in the foreground.';

/**
 * The analysis stage and percent the tab is showing, when it has one.
 * @param {{ readProgress?: (() => unknown) | null }} entry
 */
function progressOf(entry) {
  let raw = null;
  try {
    raw = typeof entry.readProgress === 'function' ? entry.readProgress() : null;
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') return { phase: null, percent: null };
  const phase = typeof raw.stage === 'string' && raw.stage ? raw.stage : null;
  const pct = Number(raw.percent);
  const percent = Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : null;
  return { phase, percent };
}

/**
 * @param {{ jobId: string, command: string, startedAt: number, readProgress?: (() => unknown) | null }} entry
 * @param {number} [now]
 */
function runningResult(entry, now = Date.now()) {
  const elapsedMs = Math.max(0, now - entry.startedAt);
  const { phase, percent } = progressOf(entry);
  const out = {
    status: 'running',
    stillRunning: true,
    jobId: entry.jobId,
    command: entry.command,
    elapsedSec: Math.round(elapsedMs / 1000),
  };
  if (phase) out.phase = phase;
  if (percent != null) out.percent = percent;
  // A straight-line estimate from the percent so far. Left out until there
  // is enough progress for it to mean something.
  if (percent != null && percent >= 5 && percent < 100) {
    out.etaSec = Math.max(1, Math.round((elapsedMs / 1000) * ((100 - percent) / percent)));
  }
  out.message = MOLD_RUNNING_MESSAGE;
  return { result: out };
}

/**
 * Resolves true when the job finished inside the budget, false when the
 * budget ran out first.
 * @param {{ settled: Promise<unknown> }} entry
 */
async function finishedWithinBudget(entry) {
  let timer = null;
  const budget = new Promise((resolve) => { timer = setTimeout(() => resolve(false), waitMs()); });
  const first = await Promise.race([entry.settled.then(() => true), budget]);
  if (timer) clearTimeout(timer);
  return first === true;
}

/**
 * Run a mold analysis under the heartbeat budget. `work` resolves to the
 * command's packed outcome (`{ result }` or `{ error }`). The promise is
 * awaited either way, so a late failure lands in the record and never as
 * an unhandled rejection.
 * @param {string} command
 * @param {Promise<{ result?: unknown, error?: unknown }>} work
 * @param {(() => unknown) | null} [readProgress]
 */
export async function moldWithBudget(command, work, readProgress = null) {
  const startedAt = Date.now();
  jobSeq += 1;
  const entry = {
    jobId: `mold-${jobSeq}-${startedAt.toString(36)}`,
    command,
    startedAt,
    done: false,
    finishedAt: 0,
    outcome: null,
    readProgress: typeof readProgress === 'function' ? readProgress : null,
    settled: null,
  };
  entry.settled = Promise.resolve(work).then(
    (out) => { entry.done = true; entry.finishedAt = Date.now(); entry.outcome = out; return out; },
    (err) => {
      entry.done = true;
      entry.finishedAt = Date.now();
      entry.outcome = { error: { code: 'internal', message: String(err?.message || err) } };
      return entry.outcome;
    },
  );
  if (await finishedWithinBudget(entry)) return entry.outcome;
  pruneJobs();
  jobs.set(entry.jobId, entry);
  return runningResult(entry);
}

/**
 * A mold command's outcome, under the budget when the host answered a
 * promise. A synchronous answer is returned as it is.
 * @param {string} command
 * @param {unknown} out the host handler's return value
 * @param {{ moldProgress?: () => unknown }} ctx
 */
export function packMoldOutcome(command, out, ctx) {
  const pack = (value) => (value?.error ? { error: value.error } : { result: value });
  if (out && typeof out.then === 'function') {
    return moldWithBudget(command, out.then(pack), typeof ctx?.moldProgress === 'function' ? ctx.moldProgress : null);
  }
  return pack(out);
}

/**
 * The next heartbeat or the final result of a mold analysis that answered
 * `running`. It waits up to the budget, so an agent polling it hears from
 * the tab about every 30 s and does not spin.
 */
export const moldStatusCommand = Object.freeze({
  name: 'mold_status',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['job_id'],
    properties: {
      job_id: { type: 'string', description: 'jobId from a mold_* call that answered status running' },
    },
  }),
  example: { job_id: 'mold-1-abc' },
  immediate: true,
  checkArgs(args) {
    const id = typeof args?.job_id === 'string' ? args.job_id.trim() : '';
    if (!id) return { code: 'bad_args', message: 'mold_status needs job_id' };
    return null;
  },
  async run(_ctx, args) {
    const id = String(args?.job_id || '').trim();
    pruneJobs();
    const entry = jobs.get(id);
    if (!entry) {
      return {
        error: {
          code: 'unknown_job',
          message: `No running or recent mold analysis ${id}; a mold_* call answers its result directly when it finishes within the budget.`,
        },
      };
    }
    if (!entry.done && !(await finishedWithinBudget(entry))) return runningResult(entry);
    const out = entry.outcome;
    if (out && out.result && typeof out.result === 'object' && !Array.isArray(out.result)) {
      return { result: { ...out.result, jobId: entry.jobId } };
    }
    return out;
  },
});
