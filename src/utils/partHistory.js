/**
 * Undo stack for one part.
 *
 * The editor has one Monaco buffer, but each part keeps its own commits.
 * Switching parts swaps stacks. A commit is never copied onto another part.
 *
 * Each Confirm is one feature step. On a fresh load, the stack is seeded from
 * the script's feature markers so strip Undo can walk those steps. Redo only
 * exists in-session — a reload puts the head on the full script.
 */

import { parseFeatureMarkers } from './featureMarkers.js';

export function emptyPartHistory() {
  return { commits: [], head: -1 };
}

/** Drop feature blocks from `keepCount` onward; keep earlier ones in place. */
export function scriptWithFeatureCount(script, keepCount) {
  const text = typeof script === 'string' ? script : '';
  const features = parseFeatureMarkers(text);
  const keep = Math.max(0, Math.min(Number(keepCount) || 0, features.length));
  if (keep >= features.length) return text;

  let out = text;
  for (let i = features.length - 1; i >= keep; i -= 1) {
    const f = features[i];
    out = out.slice(0, f.startOffset) + out.slice(f.endOffset);
  }
  out = out.replace(/\n{3,}/g, '\n\n').replace(/^\s+/, '').replace(/\s+$/, '');
  // A lone trailing return with no part binding left is an empty step.
  if (/^(?:return\s+part\s*;\s*)?$/i.test(out)) return '';
  if (out && !/\n$/.test(out)) out += '\n';
  return out;
}

/**
 * One commit per feature step, plus a before-any-features seed.
 * Head sits on the full script so Reload enables Undo and clears Redo.
 */
export function featureHistoryCommits(script) {
  const code = typeof script === 'string' ? script : '';
  const features = parseFeatureMarkers(code);
  if (!features.length) {
    return [{
      code,
      message: 'Part',
      timestamp: 0,
      id: 'seed:0',
    }];
  }
  const commits = [];
  for (let k = 0; k <= features.length; k += 1) {
    const step = scriptWithFeatureCount(code, k);
    const message = k === 0
      ? 'Part'
      : (features[k - 1].label || features[k - 1].kind || 'Feature');
    commits.push({
      code: k === features.length ? code : step,
      message,
      timestamp: 0,
      id: `seed:${k}`,
    });
  }
  return commits;
}

/**
 * The stack already stored for this part, or feature steps seeded from its script.
 * With markers, head > 0 so strip Undo walks features after a fresh load.
 */
export function historyForPart(histories, partId, script) {
  const key = partId == null ? '' : String(partId);
  const existing = histories && histories[key];
  if (existing && Array.isArray(existing.commits) && existing.commits.length) {
    return existing;
  }
  const commits = featureHistoryCommits(script);
  return {
    commits,
    head: commits.length - 1,
  };
}

/**
 * True only when this part has no commits yet.
 *
 * Monaco calls this from `editorDidMount`. A later mount — the mobile shell
 * after a narrow viewport, or the drawer — must not record the boot script
 * as "Initial script". That commit lands on top of the live step, so the
 * next undo restores the step underneath (the one that was just applied).
 */
export function editorMountSeedsHistory(history) {
  const head = history && Number.isInteger(history.head) ? history.head : -1;
  return head < 0;
}

/** Append a commit. The same code as the current head is not a new step. */
export function pushPartHistory(history, code, message) {
  const base = history && Array.isArray(history.commits) ? history : emptyPartHistory();
  const head = Number.isInteger(base.head) ? base.head : -1;
  const top = head >= 0 ? base.commits[head] : null;
  if (top && top.code === code) return { commits: base.commits, head };
  const commits = base.commits.slice(0, Math.max(0, head + 1));
  commits.push({
    code,
    message: message || 'Code updated',
    timestamp: Date.now(),
    id: `${Date.now()}-${commits.length}`,
  });
  return { commits, head: commits.length - 1 };
}

/** Step back on this part only. `code` is null when there is nothing to undo. */
export function undoPartHistory(history) {
  if (!history || !(history.head > 0) || !Array.isArray(history.commits)) {
    return { history: history || emptyPartHistory(), code: null };
  }
  const head = history.head - 1;
  const code = history.commits[head]?.code;
  if (typeof code !== 'string') return { history, code: null };
  return { history: { commits: history.commits, head }, code };
}

/** Step forward on this part only. `code` is null when there is nothing to redo. */
export function redoPartHistory(history) {
  if (!history || !Array.isArray(history.commits)) {
    return { history: history || emptyPartHistory(), code: null };
  }
  if (history.head >= history.commits.length - 1) return { history, code: null };
  const head = history.head + 1;
  const code = history.commits[head]?.code;
  if (typeof code !== 'string') return { history, code: null };
  return { history: { commits: history.commits, head }, code };
}
