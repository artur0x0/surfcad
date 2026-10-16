/**
 * Post-step invariant checks for the bug hunter (bridge + light DOM probes).
 */
/* global document, window, HTMLInputElement */

/** Bridge refusals that are intentional, not product bugs. */
export const INTENTIONAL_REFUSAL_CODES = new Set([
  'real_repo_blocked',
  'confirm_required',
  'consent_pending',
  'consent_declined',
  'not_paired',
  'picker_busy',
  'no_feature_edit',
  'nothing_to_undo',
  'nothing_to_redo',
]);

/**
 * @param {object} envelope bridge envelope from agentCall
 */
export function classifyEnvelope(envelope) {
  if (!envelope) return { kind: 'missing' };
  if (envelope.ok === false) {
    const code = envelope.error?.code || 'unknown';
    if (INTENTIONAL_REFUSAL_CODES.has(code)) {
      return { kind: 'refusal', code, message: envelope.error?.message };
    }
    return { kind: 'bridge_error', code, message: envelope.error?.message };
  }
  const runOk = envelope.result?.ok;
  if (runOk === false) {
    const errors = envelope.result?.errors || [];
    return { kind: 'run_failure', errors };
  }
  return { kind: 'ok' };
}

/**
 * @param {import('playwright-core').Page} page
 */
export async function readBridgeHealth(page, agentCall) {
  const [status, errors, history] = await Promise.all([
    agentCall(page, 'status', {}),
    agentCall(page, 'errors', {}),
    agentCall(page, 'history', {}),
  ]);

  const findings = [];
  const vol = status.result?.volume;
  const bbox = status.result?.bbox;
  if (vol != null && (!Number.isFinite(vol) || Number.isNaN(vol))) {
    findings.push({ id: 'nan_volume', detail: String(vol) });
  }
  if (bbox?.min) {
    for (const n of bbox.min.concat(bbox.max || [])) {
      if (n != null && (!Number.isFinite(n) || Number.isNaN(n))) {
        findings.push({ id: 'nan_bbox', detail: JSON.stringify(bbox) });
        break;
      }
    }
  }

  const errList = errors.result?.errors || [];
  for (const row of errList) {
    findings.push({ id: 'script_error', detail: row.message || JSON.stringify(row) });
  }

  if (history.ok === true && history.result?.head != null) {
    const head = history.result.head;
    const entries = history.result.entries || [];
    const current = entries.find((e) => e.current);
    if (current && current.index !== head) {
      findings.push({
        id: 'history_head_mismatch',
        detail: `head=${head} current.index=${current.index}`,
      });
    }
  }

  return { status, errors, history, findings };
}

/**
 * Empty number boxes in open popups (regression for #484/#486).
 * @param {import('playwright-core').Page} page
 */
export async function probeEmptyNumberBoxes(page) {
  return page.evaluate(() => {
    const rows = [];
    const inputs = document.querySelectorAll('[data-popup-number], input[type="number"]');
    for (const el of inputs) {
      if (!(el instanceof HTMLInputElement)) continue;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const val = el.value;
      const placeholder = el.getAttribute('placeholder') || '';
      if (val === '' && !placeholder) {
        rows.push({
          selector: el.getAttribute('data-popup-number') || el.name || el.id || 'input',
        });
      }
    }
    return rows;
  });
}

/**
 * @param {string[]} consoleErrors
 */
export function consoleFindings(consoleErrors) {
  if (!consoleErrors?.length) return [];
  return consoleErrors.map((text) => ({ id: 'console_error', detail: text }));
}

export function mergeFindings(...groups) {
  const out = [];
  for (const g of groups) {
    if (!g) continue;
    for (const row of g) out.push(row);
  }
  return out;
}
