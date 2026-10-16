/**
 * Delta-debug a command sequence that reproduces a finding.
 */

/**
 * @param {Array<{ command: string, args: object }>} steps
 * @param {(prefix: Array<{command:string,args:object}>) => Promise<boolean>} stillBroken
 */
export async function minimizeSteps(steps, stillBroken) {
  if (!steps.length) return [];
  let current = steps.slice();
  if (!(await stillBroken(current))) return [];

  // Drop trailing no-ops first.
  while (current.length > 1) {
    const tail = current.slice(0, -1);
    if (await stillBroken(tail)) current = tail;
    else break;
  }

  let changed = true;
  while (changed && current.length > 1) {
    changed = false;
    for (let i = 0; i < current.length; i += 1) {
      const trial = current.filter((_, j) => j !== i);
      if (!trial.length) continue;
      if (await stillBroken(trial)) {
        current = trial;
        changed = true;
        break;
      }
    }
  }
  return current;
}
