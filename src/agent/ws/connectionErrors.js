/**
 * Classify Local agent WebSocket failures for UI copy.
 */

import { PAIR_MSG } from './relayMessages.js';
import { MCP_INSTALL_COMMAND } from './pairingPrompt.js';

import { BRIDGE_CLOSE_REASON } from './bridgeMessages.js';

/** @typedef {'relay_missing' | 'origin_rejected' | 'browser_blocked' | 'relay_error' | 'bridge_closed' | 'popup_blocked' | null} AgentBridgeConnectionIssue */

/**
 * `direct`: the page opens ws://127.0.0.1 itself (Chrome, Edge, Firefox, local dev).
 * `popup`: frames go through the loopback bridge window (desktop Safari on https).
 * `unsupported`: no pairing path (iOS / iPadOS on https).
 *
 * @typedef {'direct' | 'popup' | 'unsupported'} AgentBridgePairingMode
 */

/**
 * @param {string | undefined} hostname
 */
export function isLocalDevPageHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const h = hostname.trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.startsWith('127.');
}

/**
 * iOS (all browsers use WebKit) or desktop Safari.
 *
 * @param {string | undefined} userAgent
 */
export function isWebKitLoopbackPairingBrowser(userAgent) {
  const ua = String(userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  if (/Safari/i.test(ua) && !/Chrome|Chromium|Edg\/|CriOS|FxiOS|EdgiOS/i.test(ua)) {
    return true;
  }
  return false;
}

/**
 * iPhone, iPod, or iPad. iPadOS Safari sends a Macintosh user agent by
 * default, so a touch-capable "Mac" counts as an iPad.
 *
 * @param {string | undefined} userAgent
 * @param {number | undefined} [maxTouchPoints]
 */
export function isIOSLikeBrowser(userAgent, maxTouchPoints) {
  const ua = String(userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && Number(maxTouchPoints) > 1;
}

/**
 * Safari/WebKit cannot open ws://127.0.0.1 from an https page that is not
 * itself on loopback, so desktop Safari pairs through the popup bridge.
 *
 * @param {{ protocol?: string, hostname?: string, userAgent?: string, maxTouchPoints?: number, override?: 'direct' | 'popup' | null }} [env]
 * @returns {AgentBridgePairingMode}
 */
export function agentBridgePairingMode(env = {}) {
  if (env.override === 'direct' || env.override === 'popup') return env.override;
  const protocol = typeof env.protocol === 'string' ? env.protocol : '';
  const hostname = typeof env.hostname === 'string' ? env.hostname : '';
  if (protocol !== 'https:') return 'direct';
  if (isLocalDevPageHostname(hostname)) return 'direct';
  if (isIOSLikeBrowser(env.userAgent, env.maxTouchPoints)) return 'unsupported';
  if (isWebKitLoopbackPairingBrowser(env.userAgent)) return 'popup';
  return 'direct';
}

/**
 * No pairing path at all on this page (iOS / iPadOS on https).
 *
 * @param {{ protocol?: string, hostname?: string, userAgent?: string, maxTouchPoints?: number }} [env]
 */
export function shouldPreemptWebKitHttpsPairing(env = {}) {
  return agentBridgePairingMode({ ...env, override: null }) === 'unsupported';
}

/**
 * After a direct socket is blocked, offer the bridge window. Chromium
 * browsers keep the direct path and its Local Network Access hint.
 *
 * @param {string} family from {@link detectBrowserFamily}
 */
export function canFallBackToPopupBridge(family) {
  return family !== 'chrome' && family !== 'edge';
}

export function detectBrowserFamily(userAgent) {
  const ua = String(userAgent || '');
  if (/Safari/i.test(ua) && !/Chrome|Chromium|Edg\//i.test(ua)) return 'safari';
  if (/Firefox\//i.test(ua)) return 'firefox';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/Chrome|Chromium/i.test(ua)) return 'chrome';
  return 'unknown';
}

/**
 * @param {string} family
 */
export function browserBlockedHint(family) {
  switch (family) {
    case 'safari':
      return 'Safari blocks secure pages from opening ws://127.0.0.1 directly (mixed content). Use the bridge window, or pair in Chrome.';
    case 'firefox':
      return 'Firefox may block this connection from an HTTPS page. Try the bridge window or Chrome, or check about:config private-network restrictions.';
    case 'chrome':
    case 'edge':
      return 'Chrome may block loopback WebSockets until Local Network Access is allowed. Check the address-bar permission icon, or enterprise policy LoopbackNetworkAllowedForUrls for surfcad.com.';
    default:
      return 'Your browser blocked the connection from this HTTPS page to ws://127.0.0.1. Try the bridge window, or Chrome on desktop.';
  }
}

/**
 * @param {{ code?: string, message?: string } | null | undefined} relayError
 * @returns {AgentBridgeConnectionIssue}
 */
export function issueFromRelayError(relayError) {
  const code = relayError?.code;
  if (code === 'origin_blocked') return 'origin_rejected';
  return 'relay_error';
}

/**
 * @param {CloseEvent | null | undefined} event
 * @param {{ sawOpen?: boolean, relayErrorCode?: string | null }} context
 * @returns {AgentBridgeConnectionIssue}
 */
export function issueFromCloseEvent(event, context = {}) {
  if (context.relayErrorCode === 'origin_blocked') return 'origin_rejected';
  const reason = event?.reason;
  if (reason === BRIDGE_CLOSE_REASON.POPUP_BLOCKED) return 'popup_blocked';
  if (reason === BRIDGE_CLOSE_REASON.BRIDGE_CLOSED) return 'bridge_closed';
  if (reason === BRIDGE_CLOSE_REASON.BRIDGE_UNREACHABLE) return 'relay_missing';
  if (!context.sawOpen) return 'relay_missing';
  return null;
}

/**
 * @param {Event | null | undefined} event
 * @param {{ pageSecure?: boolean }} context
 * @returns {AgentBridgeConnectionIssue}
 */
export function issueFromErrorEvent(event, context = {}) {
  if (context.pageSecure === true) {
    return 'browser_blocked';
  }
  return 'relay_missing';
}

/**
 * @param {unknown} message
 * @returns {AgentBridgeConnectionIssue}
 */
export function issueFromRelayMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const msg = message;
  if (msg.type === PAIR_MSG.ERROR && msg.code === 'origin_blocked') {
    return 'origin_rejected';
  }
  return null;
}

export const MCP_START_COMMAND = MCP_INSTALL_COMMAND;
