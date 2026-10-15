/**
 * Per-scenario step recorder used by scripted playtests.
 */
export function createStepRunner() {
  /** @type {Array<{ id: string, call?: string, args?: object, ms: number, ok: boolean, detail?: string, envelope?: object }>} */
  const steps = [];
  /** @type {Array<{ call: string, args: object }>} */
  const replaySteps = [];

  let failed = 0;

  /**
   * @param {string} id
   * @param {() => Promise<{ ok: boolean, detail?: string, call?: string, args?: object, envelope?: object }>} fn
   */
  async function runStep(id, fn) {
    const t0 = Date.now();
    let ok = false;
    let detail = '';
    let call;
    let args;
    let envelope;
    try {
      const out = await fn();
      ok = out.ok === true;
      detail = out.detail || '';
      call = out.call;
      args = out.args;
      envelope = out.envelope;
      if (call) replaySteps.push({ call, args: args ?? {} });
    } catch (err) {
      ok = false;
      detail = err?.message || String(err);
    }
    const ms = Date.now() - t0;
    if (!ok) failed += 1;
    steps.push({ id, call, args, ms, ok, detail, envelope });
    return ok;
  }

  return {
    steps,
    replaySteps,
    get failed() { return failed; },
    runStep,
  };
}
