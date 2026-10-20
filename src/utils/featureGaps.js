/**
 * FEATURE-GAP notes: the comment every script snippet starts with, naming
 * the feature that would have made the snippet unnecessary.
 *
 *   // FEATURE-GAP: <missing feature or option> | <why the existing feature did not work>
 *
 * The Script button (palette id `codeSnippet`, tool `insert_code_snippet`)
 * writes it; `parseFeatureGaps` reads it back from any script, so a grep
 * over the saved parts (`scripts/feature-gaps.mjs`) is the feature backlog;
 * `reportFeatureGaps` sends each new gap to Sentry once per page load, and
 * only when the user accepted all cookies (Artur, 2026-10-20).
 */
import { FEATURE_GAP_PREFIX } from '../agent/buildGuidance.js';

// The code block markers, spelled out here: helperPaletteSnippets.js imports
// this file, and featureMarkers.js imports helperPaletteSnippets.js, so an
// import of either from here would be a cycle.
const CODE_BEGIN_RE = /^\s*\/\/ --- code begin(?:\s+id=(\S+))?\s*---\s*$/;
const CODE_END_RE = /^\s*\/\/ --- code end\s*---\s*$/;

export { FEATURE_GAP_PREFIX };

const GAP_LINE = /^\s*\/\/\s*FEATURE-GAP:\s*(.*?)\s*$/;
const GAP_MAX = 200;

function clean(text, fallback) {
  const t = String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (t || fallback).slice(0, GAP_MAX);
}

/** The comment line for a gap. `|` inside the texts becomes `/`. */
export function featureGapLine(gap, why) {
  const missing = clean(gap, 'unspecified').replace(/\|/g, '/');
  const reason = clean(why, 'not stated').replace(/\|/g, '/');
  return `${FEATURE_GAP_PREFIX} ${missing} | ${reason}`;
}

/**
 * Every FEATURE-GAP line in `script`, with the code block it sits in
 * (`featureId` is the block's `id=` when it has one, else `code-<n>` by
 * code-block order, else null outside any block).
 * @param {string} script
 * @returns {Array<{ gap: string, why: string, line: number, featureId: string | null }>}
 */
export function parseFeatureGaps(script) {
  if (typeof script !== 'string' || !script.includes('FEATURE-GAP')) return [];
  const out = [];
  let block = null;
  let blocks = 0;
  const lines = script.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    const begin = CODE_BEGIN_RE.exec(text);
    if (begin) {
      block = begin[1] || `code-${blocks}`;
      blocks += 1;
      continue;
    }
    if (CODE_END_RE.test(text)) {
      block = null;
      continue;
    }
    const m = GAP_LINE.exec(text);
    if (m) {
      const [gapRaw, ...rest] = m[1].split('|');
      out.push({ gap: clean(gapRaw, 'unspecified'), why: clean(rest.join('|'), ''), line: i + 1, featureId: block });
    }
  }
  return out;
}

/** One key per distinct gap (case and spacing folded). */
export function featureGapKey(row) {
  return `${String(row?.gap || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

/** Gaps across many scripts, unique by key, with where they were seen. */
export function collectFeatureGaps(scripts, names = {}) {
  const byKey = new Map();
  for (const [id, script] of Object.entries(scripts || {})) {
    for (const row of parseFeatureGaps(script)) {
      const key = featureGapKey(row);
      if (!key) continue;
      const entry = byKey.get(key) || { gap: row.gap, whys: new Set(), parts: new Set(), count: 0 };
      entry.count += 1;
      if (row.why) entry.whys.add(row.why);
      entry.parts.add(names[id] || id);
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()]
    .map((e) => ({ gap: e.gap, count: e.count, whys: [...e.whys], parts: [...e.parts] }))
    .sort((a, b) => b.count - a.count || a.gap.localeCompare(b.gap));
}

const reported = new Set();

/** For tests: forget what was reported this page load. */
export function resetFeatureGapReports() {
  reported.clear();
}

/**
 * Send each gap in `scripts` to Sentry once per page load, as an info
 * event tagged `category: feature_gap`, fingerprinted by the gap so one
 * missing feature is one issue. Nothing is sent without analytics consent,
 * and nothing but the gap text and the reason leaves the page: no script,
 * no part names.
 *
 * @param {Record<string, string> | string} scripts
 * @param {{ consent: boolean, capture: (error: Error, context: object) => unknown }} deps
 * @returns {Array<{ gap: string, why: string }>} the gaps reported by this call
 */
export function reportFeatureGaps(scripts, deps) {
  if (!deps || deps.consent !== true || typeof deps.capture !== 'function') return [];
  const bag = typeof scripts === 'string' ? { script: scripts } : (scripts || {});
  const sent = [];
  for (const script of Object.values(bag)) {
    for (const row of parseFeatureGaps(script)) {
      const key = featureGapKey(row);
      if (!key || reported.has(key)) continue;
      reported.add(key);
      const error = new Error(`FEATURE-GAP: ${row.gap}${row.why ? ` | ${row.why}` : ''}`);
      error.name = 'FeatureGap';
      try {
        deps.capture(error, {
          level: 'info',
          tags: { category: 'feature_gap', handled: 'true', feature_gap: row.gap.slice(0, 80) },
          fingerprint: ['feature-gap', key],
        });
      } catch (_) { /* reporting never breaks a build */ }
      sent.push({ gap: row.gap, why: row.why });
    }
  }
  return sent;
}
