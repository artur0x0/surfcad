/**
 * Pending join code kept in this tab so a Safari reload can show the same
 * code. The display code is stored; the server keeps only a hash. The
 * session cookie is what re-attaches the code to the account.
 */

export const JOIN_CODE_STORAGE_KEY = 'surfcad.agent.join';

/**
 * @param {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined} storage
 * @param {{ id?: string, code?: string, expiresAt?: string }} record
 */
export function saveStoredJoin(storage, record) {
  if (!storage || typeof storage.setItem !== 'function') return;
  try {
    storage.setItem(JOIN_CODE_STORAGE_KEY, JSON.stringify({
      id: String(record.id || ''),
      code: String(record.code || ''),
      expiresAt: String(record.expiresAt || ''),
    }));
  } catch { /* private mode */ }
}

/**
 * @param {Pick<Storage, 'getItem'> | null | undefined} storage
 * @returns {{ id: string, code: string, expiresAt: string } | null}
 */
export function loadStoredJoin(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    const raw = storage.getItem(JOIN_CODE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const id = typeof parsed.id === 'string' ? parsed.id : '';
    const code = typeof parsed.code === 'string' ? parsed.code : '';
    const expiresAt = typeof parsed.expiresAt === 'string' ? parsed.expiresAt : '';
    if (!id || !code || !expiresAt) return null;
    return { id, code, expiresAt };
  } catch {
    return null;
  }
}

/**
 * @param {Pick<Storage, 'removeItem'> | null | undefined} storage
 */
export function clearStoredJoin(storage) {
  if (!storage || typeof storage.removeItem !== 'function') return;
  try {
    storage.removeItem(JOIN_CODE_STORAGE_KEY);
  } catch { /* private mode */ }
}

/**
 * After a reload, restore only a still-pending code for this tab.
 * A redeemed code for this tab is already connected. Expired, dead,
 * superseded, missing, and a mismatched id clear the stored code.
 * A 401 means the session cookie did not survive; the caller clears the
 * code and does not change sign-in.
 *
 * @param {{
 *   stored: { id: string, code: string, expiresAt: string } | null,
 *   httpStatus: number,
 *   body: { status?: string, id?: string, expiresAt?: string } | null,
 *   now: number,
 * }} input
 * @returns {'restore' | 'connected' | 'clear'}
 */
export function resumeJoinAction(input) {
  const stored = input.stored;
  if (!stored) return 'clear';
  if (input.httpStatus === 401 || input.httpStatus === 403) return 'clear';
  const body = input.body;
  // Redeem wins over the local clock. The phone may resume a moment
  // after the displayed expiry and still have a live agent.
  if (body?.status === 'redeemed' && body.id === stored.id) return 'connected';
  const storedExpiry = Date.parse(stored.expiresAt);
  if (!Number.isFinite(storedExpiry) || storedExpiry <= input.now) return 'clear';
  if (!body || body.status !== 'pending' || body.id !== stored.id) return 'clear';
  const serverExpiry = Date.parse(body.expiresAt || '');
  if (!Number.isFinite(serverExpiry) || serverExpiry <= input.now) return 'clear';
  return 'restore';
}

/**
 * Poll result for the waiting card. Only this tab's redeemed code connects.
 * Pending, dead, superseded, and a different id leave the card alone.
 *
 * @param {{ status?: string, id?: string } | null | undefined} body
 * @param {string} id
 * @returns {'redeemed' | null}
 */
export function joinPollEvent(body, id) {
  if (!body || !id || body.id !== id) return null;
  if (body.status === 'redeemed') return 'redeemed';
  return null;
}
