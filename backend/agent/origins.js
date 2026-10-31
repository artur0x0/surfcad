import { isAllowedHttpOrigin } from '../../packages/surfcad-mcp/src/bridge/localAddress.mjs';

/**
 * Browser-tab sockets must send an Origin the local relay already allows
 * (surfcad.com, www, localhost). A missing Origin is rejected here. The
 * local helper treats a missing Origin as a Node peer; that is not a tab.
 * @param {unknown} origin
 * @returns {boolean}
 */
export function isAllowedBrowserOrigin(origin) {
  if (typeof origin !== 'string') return false;
  const trimmed = origin.trim();
  if (!trimmed) return false;
  return isAllowedHttpOrigin(trimmed);
}
