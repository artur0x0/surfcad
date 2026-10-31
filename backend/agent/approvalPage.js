/**
 * Minimal signed-in approval page. R3 can replace the layout; the sentence
 * and the Allow / Deny actions stay.
 */

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
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.4; }
  main { max-width: 32rem; }
  button, input { font: inherit; }
  form { margin: 0.75rem 0; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

export function signInPage() {
  return document({
    title: 'Connect an agent',
    body: '<h1>Connect an agent</h1><p>Sign in to SurfCAD to approve an agent.</p>',
  });
}

/**
 * @param {string} [message]
 * @param {string} [csrf]
 */
export function codeFormPage(message, csrf) {
  const note = message ? `<p>${escapeHtml(message)}</p>` : '';
  return document({
    title: 'Connect an agent',
    body: `<h1>Connect an agent</h1>
${note}
<p>Enter the code shown by the agent.</p>
<form method="post" action="/agent/pair/claim">
  <input type="hidden" name="csrf" value="${escapeHtml(csrf || '')}">
  <label>Code <input name="userCode" autocomplete="one-time-code" spellcheck="false"></label>
  <button type="submit">Continue</button>
</form>`,
  });
}

/**
 * @param {{ sentence: string, userCode: string, csrf?: string }} fields
 */
export function approvePage(fields) {
  const code = escapeHtml(fields.userCode);
  const csrf = escapeHtml(fields.csrf || '');
  return document({
    title: 'Connect an agent',
    body: `<h1>Connect an agent</h1>
<p>${escapeHtml(fields.sentence)}</p>
<form method="post" action="/agent/pair/approve">
  <input type="hidden" name="csrf" value="${csrf}">
  <input type="hidden" name="userCode" value="${code}">
  <button type="submit">Allow</button>
</form>
<form method="post" action="/agent/pair/deny">
  <input type="hidden" name="csrf" value="${csrf}">
  <input type="hidden" name="userCode" value="${code}">
  <button type="submit">Deny</button>
</form>`,
  });
}

/**
 * @param {string} message
 */
export function donePage(message) {
  return document({
    title: 'Connect an agent',
    body: `<h1>Connect an agent</h1><p>${escapeHtml(message)}</p>`,
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
