/**
 * Classify Local agent WebSocket failures for UI copy.
 */

import { PAIR_MSG } from './relayMessages.js';

/** @typedef {'relay_missing' | 'origin_rejected' | 'browser_blocked' | 'relay_error' | null} AgentBridgeConnectionIssue */

/**
 * @param {string | undefined} userAgent
 */
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
      return 'Safari blocks secure pages from opening ws://127.0.0.1 (mixed content). Use Chrome or Edge on desktop, or pair from a local dev build.';
    case 'firefox':
      return 'Firefox may block this connection from an HTTPS page. Try Chrome or Edge, or check about:config private-network restrictions.';
    case 'chrome':
    case 'edge':
      return 'Chrome may block loopback WebSockets until Local Network Access is allowed. Check the address-bar permission icon, or enterprise policy LoopbackNetworkAllowedForUrls for surfcad.com.';
    default:
      return 'Your browser blocked the connection from this HTTPS page to ws://127.0.0.1. Try Chrome or Edge on desktop.';
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

export const MCP_START_COMMAND = 'npx surfcad-mcp';
