import { createRateLimiter } from '../services/rateLimiter.js';
import { createAgentSocketRegistry } from './agentSockets.js';
import { createTabSocketRegistry } from './tabSockets.js';
import { createSystemClock } from './clock.js';
import {
  BROWSER_ROUTE_LIMIT,
  BROWSER_ROUTE_WINDOW_MS,
  COMMAND_LIMIT,
  COMMAND_READ_LIMIT,
  COMMAND_READ_WINDOW_MS,
  COMMAND_WINDOW_MS,
  MAX_AGENT_MESSAGE_BYTES,
  SOCKET_CONNECT_LIMIT,
  SOCKET_CONNECT_WINDOW_MS,
  SOCKET_PING_INTERVAL_MS,
} from './limits.js';
import { createJoinCodeService } from './joinCode.js';
import { createPairingService } from './pairing.js';
import { createMemoryTabRegistry } from './registry.js';
import { createAgentRouter } from './router.js';
import { createTokenService } from './tokens.js';

/**
 * One process-local relay: token hashes, device-code pairing, and the tab
 * registry. Pass a clock and tighter limits from tests.
 * @param {{
 *   clock?: ReturnType<typeof createSystemClock>,
 *   tokenStore?: object,
 *   tokenTtlMs?: number,
 *   pairing?: object,
 *   asleepMs?: number,
 *   retentionMs?: number,
 *   commandLimit?: number,
 *   commandWindowMs?: number,
 *   maxMessageBytes?: number,
 *   maxPending?: number,
 *   maxTabs?: number,
 *   maxAgents?: number,
 *   browserLimit?: number,
 *   browserWindowMs?: number,
 *   readLimit?: number,
 *   readWindowMs?: number,
 *   connectLimit?: number,
 *   connectWindowMs?: number,
 *   pingIntervalMs?: number,
 *   lookupCity?: (ip: string | undefined) => Promise<string | null>,
 *   join?: object,
 * }} [overrides]
 */
export function createAgentRelay(overrides = {}) {
  const clock = overrides.clock || createSystemClock();
  const now = () => clock.now();
  const tokens = createTokenService({
    store: overrides.tokenStore,
    now,
    ttlMs: overrides.tokenTtlMs,
  });
  const pairing = createPairingService({
    ...(overrides.pairing || {}),
    tokens,
    now,
  });
  const joinCodes = createJoinCodeService({
    ...(overrides.join || {}),
    tokens,
    now,
  });
  const registry = createMemoryTabRegistry({
    clock,
    asleepMs: overrides.asleepMs,
    retentionMs: overrides.retentionMs,
    maxPending: overrides.maxPending,
    maxTabs: overrides.maxTabs,
    maxAgents: overrides.maxAgents,
    promptHoldMs: overrides.promptHoldMs,
    presenceTtlMs: overrides.presenceTtlMs,
  });
  const agentSockets = createAgentSocketRegistry({
    maxPerUser: overrides.maxAgents,
  });
  const tabSockets = createTabSocketRegistry();
  const commandLimiter = createRateLimiter({
    limit: overrides.commandLimit ?? COMMAND_LIMIT,
    windowMs: overrides.commandWindowMs ?? COMMAND_WINDOW_MS,
    now,
  });
  const browserLimiter = createRateLimiter({
    limit: overrides.browserLimit ?? BROWSER_ROUTE_LIMIT,
    windowMs: overrides.browserWindowMs ?? BROWSER_ROUTE_WINDOW_MS,
    now,
  });
  const readLimiter = createRateLimiter({
    limit: overrides.readLimit ?? COMMAND_READ_LIMIT,
    windowMs: overrides.readWindowMs ?? COMMAND_READ_WINDOW_MS,
    now,
  });
  const connectLimiter = createRateLimiter({
    limit: overrides.connectLimit ?? SOCKET_CONNECT_LIMIT,
    windowMs: overrides.connectWindowMs ?? SOCKET_CONNECT_WINDOW_MS,
    now,
  });
  const maxMessageBytes = overrides.maxMessageBytes ?? MAX_AGENT_MESSAGE_BYTES;
  const pingIntervalMs = overrides.pingIntervalMs ?? SOCKET_PING_INTERVAL_MS;
  const router = createAgentRouter({
    pairing,
    joinCodes,
    tokens,
    registry,
    commandLimiter,
    browserLimiter,
    readLimiter,
    maxMessageBytes,
    agentSockets,
    lookupCity: overrides.lookupCity,
  });
  return {
    clock,
    tokens,
    pairing,
    joinCodes,
    registry,
    agentSockets,
    tabSockets,
    commandLimiter,
    browserLimiter,
    readLimiter,
    connectLimiter,
    router,
    maxMessageBytes,
    pingIntervalMs,
  };
}
