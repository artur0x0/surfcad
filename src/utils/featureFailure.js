/**
 * Which feature a failed run failed in (feature strip red border).
 *
 * The worker runs the script as `new Function(...scope, '"use strict";\n' + script)`.
 * A throw from a helper called by the script still has one frame in that
 * anonymous function: the script line that made the call. The worker maps
 * that frame to a 1-based script line (calibrated once against a probe, so
 * the engine's header lines do not matter) and sends it with the error.
 * The line is then mapped to the marked feature block that contains it.
 *
 * That line is only a fallback. Safari / WebKit frames for a `new Function`
 * body do not reliably name `<anonymous>:L:C` (iPhone Safari never marked a
 * chip), so the worker also TRACKS which marked block is running:
 * `instrumentFeatureBlocks` puts `;__featureEnter(i);` in front of each
 * begin marker and `;__featureLeave(i);` in front of its end marker, on the
 * same lines (no line moves, so `scriptLine` still maps). A throw while a
 * block is open carries that block's id (`featureId`) and text
 * (`featureBlock`). Nothing open (syntax error, a bad `return`, code outside
 * every block) carries none, so no chip is marked. The id wins over the line.
 */
import { parseFeatureMarkers } from './featureMarkers.js';
import { hardSkipIds } from './featureSkip.js';

/** Frames of the `new Function` body: V8 `<anonymous>:L:C`, Firefox `> Function:L:C`. */
const ANON_FRAME = /(?:<anonymous>|> Function):(\d+):(\d+)/;

/** Raw line of the first anonymous-function frame in `stack`, or null. */
export function anonymousFrameLine(stack) {
  const m = ANON_FRAME.exec(String(stack || ''));
  if (!m) return null;
  const line = Number(m[1]);
  return Number.isFinite(line) && line > 0 ? line : null;
}

/**
 * Engine header offset for `new Function` bodies: a throw on body line 2
 * (script line 1, after "use strict") reports at `probeLine`.
 * @returns {number|null}
 */
export function calibrateScriptLineOffset() {
  try {
    new Function('a', '"use strict";\nthrow new Error("probe");')();
  } catch (err) {
    const line = anonymousFrameLine(err?.stack);
    if (line != null) return line - 1;
  }
  return null;
}

/** 1-based script line of the failing call, or null when the stack has none. */
export function scriptLineFromStack(stack, offset) {
  const raw = anonymousFrameLine(stack);
  if (raw == null || !Number.isFinite(offset)) return null;
  const line = raw - offset;
  return line >= 1 ? line : null;
}

/** Character offset of the start of 1-based `line` (clamped to the script). */
export function lineStartOffset(script, line) {
  const text = String(script || '');
  let at = 0;
  for (let l = 1; l < line; l++) {
    const nl = text.indexOf('\n', at);
    if (nl < 0) return text.length;
    at = nl + 1;
  }
  return at;
}

/**
 * The marked feature that holds the failing line, or null.
 * @returns {{ id: string, kind: string, typeIndex: number, block: string }|null}
 */
export function failedFeatureFor(script, line) {
  const text = String(script || '');
  if (!text || !(Number(line) >= 1)) return null;
  const at = lineStartOffset(text, Number(line));
  const lineEnd = text.indexOf('\n', at) < 0 ? text.length : text.indexOf('\n', at);
  const hit = parseFeatureMarkers(text).find((f) => f.startOffset <= lineEnd && at < f.endOffset);
  if (!hit) return null;
  return {
    id: hit.id,
    kind: hit.kind,
    typeIndex: hit.typeIndex,
    block: text.slice(hit.startOffset, hit.endOffset),
  };
}

function blockMatches(text, features, id, block) {
  if (!id || typeof block !== 'string') return null;
  return features.find((feature) => feature.id === id && text.slice(feature.startOffset, feature.endOffset) === block) || null;
}

/**
 * Ids of strip chips to draw as failed in `script`. A chip keeps the red
 * border while its block text is the one that failed, or the one a skip
 * omitted with that failure. Editing that block (or a run that succeeds)
 * clears it. Another part's script does not match.
 *
 * @param {string} script   the strip's script
 * @param {{ id: string, block: string, skipped?: Array<{ id: string, block: string }> }|null} failure
 * @returns {Set<string>}
 */
export function failedFeatureIds(script, failure) {
  const out = new Set();
  if (!failure?.id || typeof failure.block !== 'string') return out;
  const text = String(script || '');
  const features = parseFeatureMarkers(text);
  if (blockMatches(text, features, failure.id, failure.block)) out.add(failure.id);
  for (const row of failure.skipped || []) {
    if (blockMatches(text, features, row?.id, row?.block)) out.add(row.id);
  }
  return out;
}

/**
 * Chip and sheet titles for dependents that were skipped with a failure.
 * The feature that threw keeps the existing "failed on the last run" copy.
 * @returns {Record<string, { chip: string, sheet: string }>}
 */
export function failedFeatureTitles(script, failure) {
  const titles = {};
  if (!failure?.skipped) return titles;
  const text = String(script || '');
  const features = parseFeatureMarkers(text);
  const labelOf = (id) => features.find((feature) => feature.id === id)?.chipLabel || 'a feature';
  for (const row of failure.skipped) {
    if (!row || row.threw || !row.dependsOn) continue;
    const feature = blockMatches(text, features, row.id, row.block);
    if (!feature) continue;
    const who = labelOf(row.dependsOn);
    titles[feature.id] = {
      chip: `${feature.chipLabel} — skipped, depends on ${who}`,
      sheet: `Skipped — depends on ${who}`,
      dependsOn: row.dependsOn,
    };
  }
  return titles;
}

/**
 * Ids to omit after one more block throws, in script order.
 * The thrown block and its hard dependents join `skipIds`. No growth means
 * the run cannot skip its way to a solid.
 */
export function unionSkipIds(script, skipIds, featureId) {
  const have = new Set(Array.isArray(skipIds) ? skipIds : []);
  if (typeof featureId === 'string' && featureId) {
    for (const id of hardSkipIds(script, featureId)) have.add(id);
  }
  return parseFeatureMarkers(script).filter((feature) => have.has(feature.id)).map((feature) => feature.id);
}

/**
 * What a recovered or exhausted run reports. `thrownIds[0]` is the original
 * failure. Later thrown blocks stay failures. A block skipped only because
 * it uses a name or refKey from one of those is a dependent.
 */
export function featureSkipFailure(script, error, thrownIds, skipIds) {
  const text = String(script || '');
  const features = parseFeatureMarkers(text);
  const blockOf = (id) => {
    const feature = features.find((item) => item.id === id);
    return feature ? text.slice(feature.startOffset, feature.endOffset) : '';
  };
  const thrown = (Array.isArray(thrownIds) ? thrownIds : []).filter((id) => typeof id === 'string' && id);
  const thrownSet = new Set(thrown);
  const primary = thrown[0] || (typeof error?.featureId === 'string' ? error.featureId : null);
  const skipped = [];
  for (const id of Array.isArray(skipIds) ? skipIds : []) {
    if (!id || id === primary) continue;
    const threw = thrownSet.has(id);
    let dependsOn = null;
    if (!threw) {
      for (const source of thrown) {
        if (hardSkipIds(text, source).includes(id)) {
          dependsOn = source;
          break;
        }
      }
    }
    skipped.push({
      id,
      block: blockOf(id),
      threw,
      dependsOn,
    });
  }
  return {
    featureId: primary,
    featureBlock: typeof error?.featureBlock === 'string' && error.featureBlock
      ? error.featureBlock
      : blockOf(primary),
    scriptLine: Number.isFinite(error?.scriptLine) ? error.scriptLine : null,
    message: typeof error?.message === 'string' && error.message ? error.message : 'Script execution failed',
    skipped,
  };
}

// ── Feature-block tracking (engine-independent; primary mapping) ─────────

/** Scope names the instrumented script calls. Not user-visible helpers. */
export const FEATURE_TRACE_ENTER = '__featureEnter';
export const FEATURE_TRACE_LEAVE = '__featureLeave';

/** True when only spaces/tabs sit between the start of the line and `at`. */
function atLineStart(text, at) {
  for (let i = at - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '\n') return true;
    if (c !== ' ' && c !== '\t' && c !== '\r') return false;
  }
  return true;
}

/**
 * Add enter/leave calls around every marked block of `script`.
 *
 * Calls go on the marker lines themselves (`;__featureEnter(i);// --- … begin ---`),
 * so every script line keeps its number. The leading `;` makes a marker that
 * sits inside an expression a syntax error rather than a silent change; the
 * worker then runs the original script. Markers not at the start of a line
 * are skipped (that block is simply not tracked).
 *
 * @returns {{ script: string, features: Array<{ id: string, kind: string, label: string, block: string }> }}
 *   `features[i]` is the block that `i` names in the calls.
 */
export function instrumentFeatureBlocks(script) {
  const text = String(script || '');
  const feats = parseFeatureMarkers(text);
  if (!feats.length) return { script: text, features: [] };
  const inserts = [];
  const features = feats.map((f, i) => {
    const block = text.slice(f.startOffset, f.endOffset);
    // The end marker starts where the block's last marker line does.
    const endMarkerAt = text.lastIndexOf('\n', f.endOffset - 1) + 1;
    if (atLineStart(text, f.startOffset) && endMarkerAt > f.startOffset && atLineStart(text, endMarkerAt)) {
      inserts.push({ at: f.startOffset, code: `;${FEATURE_TRACE_ENTER}(${i});` });
      inserts.push({ at: endMarkerAt, code: `;${FEATURE_TRACE_LEAVE}(${i});` });
    }
    return { id: f.id, kind: f.kind, label: f.chipLabel || f.label || f.kind, block };
  });
  // Back to front so earlier offsets stay valid; at a shared offset the
  // leave of the earlier block runs before the enter of the next.
  inserts.sort((a, b) => b.at - a.at);
  let out = text;
  for (const ins of inserts) out = out.slice(0, ins.at) + ins.code + out.slice(ins.at);
  return { script: out, features };
}

/**
 * Open-block stack for one run. `enter(i)` pushes, `leave(i)` pops back to
 * (and including) `i`, so a block skipped by an early `leave` cannot linger.
 *
 * It also times each block: `leave(i)` records how long block `i` was open,
 * and `timings()` lists them in completion order. `hooks.onEnter(i)` runs on
 * every enter (the worker posts progress from it, so a watchdog that kills
 * the thread still knows which block was running); `hooks.onLeave(i, ms)`
 * on every matched leave.
 *
 * @param {{ onEnter?: (i: number) => void, onLeave?: (i: number, ms: number) => void }} [hooks]
 */
export function createFeatureTracker(hooks = {}) {
  const open = [];
  const started = new Map();
  const timings = [];
  const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now());
  return {
    enter(i) {
      open.push(i);
      started.set(i, now());
      if (typeof hooks.onEnter === 'function') hooks.onEnter(i);
    },
    leave(i) {
      const at = open.lastIndexOf(i);
      if (at >= 0) open.length = at;
      const t0 = started.get(i);
      if (t0 == null) return;
      started.delete(i);
      const ms = now() - t0;
      timings.push({ index: i, ms });
      if (typeof hooks.onLeave === 'function') hooks.onLeave(i, ms);
    },
    /** Innermost open block index, or null. */
    current() { return open.length ? open[open.length - 1] : null; },
    /** `{ index, ms }` per completed block, in completion order. */
    timings() { return timings.slice(); },
  };
}

/**
 * The failed feature named by the worker's block tracking, matched in
 * `script` by id and block text (the run's script and the strip's agree on
 * ids; the text check guards against a script that changed under it). When
 * the id moved but the identical block is still there, that block is used.
 * @returns {{ id: string, kind: string, typeIndex: number, block: string }|null}
 */
export function failedFeatureForId(script, featureId, featureBlock = null) {
  const text = String(script || '');
  if (!text || typeof featureId !== 'string' || !featureId) return null;
  const feats = parseFeatureMarkers(text);
  const shape = (f) => ({
    id: f.id,
    kind: f.kind,
    typeIndex: f.typeIndex,
    block: text.slice(f.startOffset, f.endOffset),
  });
  const byId = feats.find((f) => f.id === featureId);
  if (byId && (typeof featureBlock !== 'string' || text.slice(byId.startOffset, byId.endOffset) === featureBlock)) {
    return shape(byId);
  }
  if (typeof featureBlock === 'string') {
    const same = feats.filter((f) => text.slice(f.startOffset, f.endOffset) === featureBlock);
    if (same.length === 1) return shape(same[0]);
  }
  return null;
}

/**
 * Feature a failed run outcome points at: the worker's tracked block first,
 * the stack's script line second (V8 / Firefox), else null.
 */
export function failedFeatureFromOutcome(script, { featureId = null, featureBlock = null, scriptLine = null } = {}) {
  return failedFeatureForId(script, featureId, featureBlock) || failedFeatureFor(script, scriptLine);
}
