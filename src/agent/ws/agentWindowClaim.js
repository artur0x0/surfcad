/**
 * The agent window claim (server relay).
 *
 * Several SurfCAD windows or devices can be open on one account. The agent's
 * activity (dots, fold, spinner, replies) and its commands go to one of
 * them: the window the user started pairing in, or last sent a prompt from.
 * This tab tells the server it is that window with `tab.claim`; the server
 * answers `tab.claimed` with an opaque claim id.
 *
 * The id is kept in sessionStorage, which is per tab and survives a reload,
 * so the same tab resumes the role on its next socket. The server refuses a
 * resume once another window has claimed, and the tab then forgets the id.
 * Nothing here is a credential: the id only orders windows of one signed-in
 * account.
 */

export const AGENT_WINDOW_CLAIM_KEY = 'surfcad.agent.window';
export const TAB_CLAIM = 'tab.claim';
export const TAB_CLAIMED = 'tab.claimed';
const CLAIM_MAX = 64;

/**
 * @param {Storage | null | undefined} [storage]
 * @returns {{ read: () => string | null, write: (claim: string) => void, clear: () => void }}
 */
export function createAgentWindowClaimStore(storage) {
  let area = storage;
  if (area === undefined) {
    try {
      area = typeof window !== 'undefined' ? window.sessionStorage : null;
    } catch {
      area = null;
    }
  }
  return {
    read() {
      try {
        const value = area?.getItem(AGENT_WINDOW_CLAIM_KEY);
        return typeof value === 'string' && value && value.length <= CLAIM_MAX ? value : null;
      } catch {
        return null;
      }
    },
    write(claim) {
      if (typeof claim !== 'string' || !claim || claim.length > CLAIM_MAX) return;
      try { area?.setItem(AGENT_WINDOW_CLAIM_KEY, claim); } catch { /* private mode */ }
    },
    clear() {
      try { area?.removeItem(AGENT_WINDOW_CLAIM_KEY); } catch { /* private mode */ }
    },
  };
}

/**
 * The claim frame for a socket that just registered, or null.
 * A fresh claim (the user started pairing here) wins over a stored one.
 * @param {{ wanted: boolean, stored: string | null }} input
 * @returns {{ type: 'tab.claim', v: 1, claim?: string } | null}
 */
export function claimFrameOnRegister({ wanted, stored }) {
  if (wanted) return { type: TAB_CLAIM, v: 1 };
  if (stored) return { type: TAB_CLAIM, v: 1, claim: stored };
  return null;
}
