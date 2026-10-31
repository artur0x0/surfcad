import { createRateLimiter } from '../services/rateLimiter.js';
import { createAgentSocketRegistry } from './agentSockets.js';
import { createSystemClock } from './clock.js';
import { COMMAND_LIMIT, COMMAND_WINDOW_MS, MAX_AGENT_MESSAGE_BYTES } from './limits.js';
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
 *   lookupCity?: (ip: string | undefined) => Promise<string | null>,
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
  const registry = createMemoryTabRegistry({
    clock,
    asleepMs: overrides.asleepMs,
    retentionMs: overrides.retentionMs,
    maxPending: overrides.maxPending,
  });
  const agentSockets = createAgentSocketRegistry();
  const commandLimiter = createRateLimiter({
    limit: overrides.commandLimit ?? COMMAND_LIMIT,
    windowMs: overrides.commandWindowMs ?? COMMAND_WINDOW_MS,
    now,
  });
  const maxMessageBytes = overrides.maxMessageBytes ?? MAX_AGENT_MESSAGE_BYTES;
  const router = createAgentRouter({
    pairing,
    tokens,
    registry,
    commandLimiter,
    maxMessageBytes,
    agentSockets,
    lookupCity: overrides.lookupCity,
  });
  return {
    clock,
    tokens,
    pairing,
    registry,
    agentSockets,
    commandLimiter,
    router,
    maxMessageBytes,
  };
}
