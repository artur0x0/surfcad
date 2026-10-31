/**
 * Copy text from a click.
 * Secure contexts use the async clipboard. Plain http (iPhone Safari at a
 * LAN address) has no `navigator.clipboard`, so the fallback is a hidden
 * textarea and `document.execCommand('copy')` while the click is still the
 * user gesture. A missing API and a thrown writeText both take that path.
 * Success is the boolean the caller uses before it shows "Copied".
 *
 * @param {string} text
 * @param {{
 *   navigator?: { clipboard?: { writeText?: (value: string) => Promise<void> } },
 *   document?: {
 *     body?: { appendChild: (node: unknown) => void },
 *     createElement: (tag: string) => {
 *       value: string,
 *       style: Record<string, string>,
 *       setAttribute: (name: string, value: string) => void,
 *       focus: () => void,
 *       select: () => void,
 *       remove: () => void,
 *     },
 *     execCommand: (command: string) => boolean,
 *   },
 * }} [env]
 * @returns {Promise<boolean>}
 */
export async function copyTextWithFallback(text, env = globalThis) {
  const value = String(text ?? '');
  const writeText = env.navigator?.clipboard?.writeText;
  if (typeof writeText === 'function') {
    try {
      await writeText.call(env.navigator.clipboard, value);
      return true;
    } catch { /* plain http, or a denied permission */ }
  }
  return copyWithExecCommand(value, env.document);
}

/**
 * @param {string} value
 * @param {{
 *   body?: { appendChild: (node: unknown) => void },
 *   createElement?: (tag: string) => {
 *     value: string,
 *     style: Record<string, string>,
 *     setAttribute: (name: string, value: string) => void,
 *     focus: () => void,
 *     select: () => void,
 *     remove: () => void,
 *   },
 *   execCommand?: (command: string) => boolean,
 * } | null | undefined} doc
 */
function copyWithExecCommand(value, doc) {
  if (!doc?.body || typeof doc.createElement !== 'function' || typeof doc.execCommand !== 'function') {
    return false;
  }
  const area = doc.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  // display:none is not selectable, so execCommand('copy') returns false.
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  doc.body.appendChild(area);
  let ok = false;
  try {
    area.focus();
    area.select();
    ok = doc.execCommand('copy') === true;
  } catch {
    ok = false;
  } finally {
    area.remove();
  }
  return ok;
}
