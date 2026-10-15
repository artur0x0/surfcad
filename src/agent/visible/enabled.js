import { AGENT_STORAGE_KEY } from '../../utils/agentBridge.js';

export const AGENT_VISIBLE_STORAGE_KEY = 'surfcadAgentVisible';

/**
 * Visible agent mode is opt-in on top of the agent bridge (`?agent=1` or storage).
 * @param {{ location?: { search?: string } | null, localStorage?: { getItem?: (key: string) => string | null } | null, env?: Record<string, string | undefined> }} [env]
 */
export function agentVisibleEnabled(env = {}) {
  const store = Object.prototype.hasOwnProperty.call(env, 'localStorage')
    ? env.localStorage
    : (typeof localStorage !== 'undefined' ? localStorage : null);
  const loc = Object.prototype.hasOwnProperty.call(env, 'location')
    ? env.location
    : (typeof location !== 'undefined' ? location : null);
  const procEnv = env.env || {};

  if (procEnv.AGENT_VISIBLE === '1' || procEnv.AGENT_VISIBLE === 'true') return true;

  let stored = false;
  try {
    stored = !!(store && typeof store.getItem === 'function'
      && store.getItem(AGENT_VISIBLE_STORAGE_KEY) === '1');
  } catch {
    stored = false;
  }
  if (stored) return true;

  try {
    const search = loc && typeof loc.search === 'string' ? loc.search : '';
    const params = new URLSearchParams(search);
    if (params.get('visible') === '1' || params.get('visible') === 'true') return true;
    const agent = params.get('agent');
    if (agent === 'visible') return true;
    // Agent bridge must also be on unless dev (caller checks agent separately).
    if (agent === '1' && params.get('visible') === '1') return true;
  } catch {
    return false;
  }
  return false;
}

/**
 * Build default visible options from URL / storage when the bridge boots.
 * @param {{ location?: { search?: string }, localStorage?: { getItem?: (k: string) => string | null } }} [env]
 */
export function initialVisibleOptionsFromEnv(env = {}) {
  const enabled = agentVisibleEnabled(env);
  let stepDelayMs;
  try {
    const search = env.location?.search ?? (typeof location !== 'undefined' ? location.search : '');
    const params = new URLSearchParams(search);
    const raw = params.get('visibleDelay') ?? params.get('agentDelay');
    if (raw != null && raw !== '' && Number.isFinite(Number(raw))) {
      stepDelayMs = Math.max(0, Math.round(Number(raw)));
    }
  } catch { /* ignore */ }
  return { enabled, ...(stepDelayMs != null ? { stepDelayMs } : {}) };
}

/** True when the agent bridge gate would pass for the same env. */
export function agentBridgeGateFromEnv(env = {}) {
  if (env.dev === true) return true;
  const loc = env.location ?? (typeof location !== 'undefined' ? location : null);
  const store = env.localStorage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  try {
    const search = loc && typeof loc.search === 'string' ? loc.search : '';
    const params = new URLSearchParams(search);
    const agent = params.get('agent');
    if (agent === '1' || agent === 'visible') return true;
  } catch { /* ignore */ }
  try {
    if (store?.getItem?.(AGENT_STORAGE_KEY) === '1') return true;
  } catch { /* ignore */ }
  return false;
}
