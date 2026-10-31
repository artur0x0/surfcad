/**
 * Signed-in approval page. Served by Express under `/agent` because the
 * documented nginx block sends that path to Node. Class names match the
 * app (`surface-light`, `text-on-light`, `surface-success`). The tokens
 * are inlined: this response is not the Vite bundle.
 */

import { CITY_LOOKUP_CREDIT, CITY_LOOKUP_URL } from './cityLookup.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

const PAGE_CSS = `
  :root {
    --brand-paper: 250 250 249;
    --brand-ink: 22 23 29;
    --brand-grey: 107 110 120;
    --chrome-text: 243 244 246;
    --chrome-success: 4 120 87;
    --chrome-success-hover: 5 150 105;
    --chrome-border: 55 65 81;
    --chrome-background: 30 30 30;
  }
  body { margin: 0; }
  main { max-width: 28rem; margin: 0 auto; padding: 2rem 1.25rem; }
  h1 { margin: 0 0 0.75rem; font-weight: 600; }
  p { margin: 0.5rem 0; }
  button { display: block; width: 100%; margin: 0.5rem 0; padding: 0.5rem 0.75rem; border: 0; border-radius: 6px; font-weight: 600; cursor: pointer; }
  input { font: inherit; padding: 0.4rem 0.5rem; border-radius: 6px; border: 1px solid rgb(var(--chrome-border)); }
  label { display: block; margin: 0.75rem 0; }
  a { color: inherit; }
  .font-ui { font-family: ui-sans-serif, system-ui, sans-serif; }
  .surface-light { background-color: rgb(var(--brand-paper)); }
  .text-on-light { color: rgb(var(--brand-ink)); }
  .text-muted-on-light { color: rgb(var(--brand-grey)); }
  .text-on-dark { color: rgb(var(--chrome-text)); }
  .text-ui-xs { font-size: 11px; line-height: 1.4; }
  .text-ui-sm { font-size: 12px; line-height: 1.4; }
  .text-ui { font-size: 14px; line-height: 1.45; }
  .text-ui-lg { font-size: 16px; line-height: 1.4; }
  .surface-success { background-color: rgb(var(--chrome-success)); }
  .surface-success:hover { background-color: rgb(var(--chrome-success-hover)); }
  .surface-quiet { background-color: rgb(var(--chrome-border)); }
  .surface-quiet:hover { background-color: rgb(var(--chrome-background)); }
`;

/**
 * @param {{ title: string, body: string }} page
 */
function document({ title, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body class="surface-light text-on-light font-ui">
<main>
${body}
</main>
</body>
</html>`;
}

export function signInPage() {
  return document({
    title: 'Connect an agent',
    body: '<h1 class="text-ui-lg text-on-light">Connect an agent</h1><p class="text-ui text-on-light">Sign in to SurfCAD to approve an agent.</p>',
  });
}

/**
 * @param {string} [message]
 * @param {string} [csrf]
 */
export function codeFormPage(message, csrf) {
  const note = message ? `<p class="text-ui text-on-light">${escapeHtml(message)}</p>` : '';
  return document({
    title: 'Connect an agent',
    body: `<h1 class="text-ui-lg text-on-light">Connect an agent</h1>
${note}
<p class="text-ui text-muted-on-light">Enter the code shown by the agent.</p>
<form method="post" action="/agent/pair/claim">
  <input type="hidden" name="csrf" value="${escapeHtml(csrf || '')}">
  <label class="text-ui-sm text-on-light">Code <input name="userCode" autocomplete="one-time-code" spellcheck="false"></label>
  <button type="submit" class="font-ui text-ui-sm text-on-dark surface-success" data-ui-action="data-agent-approve-continue">Continue</button>
</form>`,
  });
}

/**
 * City and the agent machine's IP, on one line when both are known.
 * @param {{ city?: string | null, ip?: string | null }} fields
 */
function whereLine(fields) {
  const ip = fields.ip ? `Requesting IP: ${fields.ip}` : '';
  if (fields.city && ip) return `${fields.city}. ${ip}`;
  if (fields.city) return String(fields.city);
  return ip;
}

/**
 * The code is not on this page. The user already typed it. Allow and Deny
 * confirm that claim. A link that carries a code cannot land here filled in.
 * @param {{ sentence: string, city?: string | null, ip?: string | null, csrf?: string }} fields
 */
export function approvePage(fields) {
  const csrf = escapeHtml(fields.csrf || '');
  const where = whereLine(fields);
  const whereHtml = where
    ? `<p class="text-ui-sm text-on-light">${escapeHtml(where)}</p>`
    : '';
  const credit = fields.city
    ? `<p class="text-ui-xs text-muted-on-light"><a href="${escapeHtml(CITY_LOOKUP_URL)}">${escapeHtml(CITY_LOOKUP_CREDIT)}</a></p>`
    : '';
  return document({
    title: 'Connect an agent',
    body: `<h1 class="text-ui-lg text-on-light">Connect an agent</h1>
<p class="text-ui text-on-light">${escapeHtml(fields.sentence)}</p>
<p class="text-ui-sm text-muted-on-light">The name and machine are self-reported by the agent.</p>
${whereHtml}
${credit}
<p class="text-ui-sm text-muted-on-light">This confirms the code you typed. A link cannot approve an agent.</p>
<form method="post" action="/agent/pair/approve">
  <input type="hidden" name="csrf" value="${csrf}">
  <button type="submit" class="font-ui text-ui-sm text-on-dark surface-success" data-ui-action="data-agent-approve-allow">Allow</button>
</form>
<form method="post" action="/agent/pair/deny">
  <input type="hidden" name="csrf" value="${csrf}">
  <button type="submit" class="font-ui text-ui-sm text-on-dark surface-quiet" data-ui-action="data-agent-approve-deny">Deny</button>
</form>`,
  });
}

/**
 * @param {string} message
 */
export function donePage(message) {
  return document({
    title: 'Connect an agent',
    body: `<h1 class="text-ui-lg text-on-light">Connect an agent</h1><p class="text-ui text-on-light">${escapeHtml(message)}</p>`,
  });
}

/**
 * @param {string} error
 * @returns {string}
 */
export function entryErrorMessage(error) {
  if (error === 'expired') return 'That code has expired.';
  if (error === 'claimed') return 'That code was opened by another account.';
  if (error === 'already_used' || error === 'dead') return 'That code is no longer valid.';
  if (error === 'rate_limited' || error === 'too_many_wrong_tries') {
    return 'Too many tries. Wait and start again.';
  }
  return 'That code is not valid.';
}
