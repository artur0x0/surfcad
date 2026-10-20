const RUN_STATES = new Set(['not_run_yet', 'ok', 'failed']);
const CRASH_REASONS = new Set(['wasm_abort', 'out_of_memory', 'timeout', 'worker_lost']);

/**
 * `runState` of one part from its recorded run: `ok` for a mesh or an empty
 * part, `failed` for a run that threw (a kernel crash included), else
 * `not_run_yet` (never run, skipped because hidden, or missing).
 */
export function partRunState(run) {
  if (!run || typeof run !== 'object') return 'not_run_yet';
  if (run.ok === true || run.empty === true) return 'ok';
  if (run.skipped === true || run.missing === true) return 'not_run_yet';
  if (run.ok === false) return 'failed';
  return 'not_run_yet';
}

/** The JSON-safe crash record a parts row carries, or null. */
export function partCrashRecord(crash) {
  if (!crash || typeof crash !== 'object') return null;
  const reason = CRASH_REASONS.has(crash.reason) ? crash.reason : 'wasm_abort';
  const out = {
    code: 'geometry_worker_crashed',
    reason,
    workerRestarted: crash.workerRestarted !== false,
  };
  if (typeof crash.message === 'string' && crash.message) out.message = crash.message;
  if (Number.isFinite(crash.wasmHeapMB)) out.wasmHeapMB = crash.wasmHeapMB;
  return out;
}

/**
 * @param {{
 *   assemblyId?: string | null,
 *   activeId?: string | null,
 *   assemblyName?: string,
 *   vaultLayout?: 'v2' | 'legacy',
 *   parts?: Array<{ id: string, name?: string, visible?: boolean, group?: string, missing?: boolean }>,
 * }} input
 */
export function buildPartsState(input = {}) {
  const parts = Array.isArray(input.parts)
    ? input.parts.map((row) => {
      const part = {
        id: String(row.id),
        name: typeof row.name === 'string' ? row.name : '',
        visible: row.visible !== false,
      };
      if (typeof row.group === 'string') part.group = row.group;
      if (row.missing === true) part.missing = true;
      if (RUN_STATES.has(row.runState)) part.runState = row.runState;
      const crash = partCrashRecord(row.crash);
      if (crash) part.crash = crash;
      return part;
    })
    : [];
  const out = {
    activeId: input.activeId ?? null,
    assemblyName: typeof input.assemblyName === 'string' ? input.assemblyName : '',
    parts,
  };
  if (typeof input.assemblyId === 'string' && input.assemblyId) {
    out.assemblyId = input.assemblyId;
  }
  if (input.vaultLayout === 'v2' || input.vaultLayout === 'legacy') {
    out.vaultLayout = input.vaultLayout;
  }
  return out;
}
