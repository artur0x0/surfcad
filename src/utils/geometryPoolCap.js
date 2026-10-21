/**
 * How many geometry workers this device gets.
 *
 * Every worker is its own Manifold WASM instance with its own heap, so the
 * cap follows memory, not only cores: min(cores − 1, whole GB of
 * deviceMemory), clamped to 1..4 on a phone and 1..8 on a desktop. Where
 * deviceMemory is missing (Safari, Firefox) the fallback is 2 on a phone
 * and 4 on a desktop, still at most cores − 1. The cap counts the primary
 * worker (the one the active part, cross-sections, previews, and the game
 * use); the pool adds cap − 1 extras for the other parts.
 *
 * A dev override wins: `?geometryWorkers=N` on the URL, else
 * localStorage `surfcadGeometryWorkers`, 1..16. The thumbnail worker is
 * separate and not counted.
 */

export const GEOMETRY_WORKERS_STORAGE_KEY = 'surfcadGeometryWorkers';
export const GEOMETRY_WORKERS_QUERY_KEY = 'geometryWorkers';
export const GEOMETRY_WORKERS_MAX_OVERRIDE = 16;

const PHONE_MAX = 4;
const DESKTOP_MAX = 8;
const PHONE_FALLBACK = 2;
const DESKTOP_FALLBACK = 4;
const LOW_DEVICE_MEMORY_GB = 4;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** A positive whole number from any input, else null. */
export function parseWorkerOverride(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return clamp(Math.floor(n), 1, GEOMETRY_WORKERS_MAX_OVERRIDE);
}

/**
 * @param {{
 *   hardwareConcurrency?: number,
 *   deviceMemory?: number,
 *   phone?: boolean,
 *   override?: number | string | null,
 * }} input
 * @returns {number} total workers, primary included (≥ 1)
 */
export function geometryWorkerCap(input = {}) {
  const override = parseWorkerOverride(input.override);
  if (override) return override;
  const cores = Number(input.hardwareConcurrency);
  const byCores = Number.isFinite(cores) && cores >= 1 ? Math.floor(cores) - 1 : 1;
  const memory = Number(input.deviceMemory);
  const phone = input.phone === true;
  let cap;
  if (Number.isFinite(memory) && memory > 0) {
    cap = Math.min(byCores, Math.floor(memory));
  } else {
    cap = Math.min(byCores, phone ? PHONE_FALLBACK : DESKTOP_FALLBACK);
  }
  return clamp(cap, 1, phone ? PHONE_MAX : DESKTOP_MAX);
}

/** Touch plus a small screen, or touch plus 4 GB or less: a phone-class device. */
export function detectPhoneClass(env = {}) {
  const nav = env.navigator || (typeof navigator !== 'undefined' ? navigator : null);
  const win = env.window || (typeof window !== 'undefined' ? window : null);
  if (!nav) return false;
  const touch = (Number(nav.maxTouchPoints) || 0) > 0;
  if (!touch) return false;
  const memory = Number(nav.deviceMemory);
  if (Number.isFinite(memory) && memory > 0 && memory <= LOW_DEVICE_MEMORY_GB) return true;
  const width = Number(win?.innerWidth);
  const height = Number(win?.innerHeight);
  const shortSide = Math.min(Number.isFinite(width) ? width : Infinity, Number.isFinite(height) ? height : Infinity);
  return Number.isFinite(shortSide) && shortSide <= 820;
}

/** The dev override from the URL or localStorage, or null. Never throws. */
export function readGeometryWorkerOverride(env = {}) {
  const win = env.window || (typeof window !== 'undefined' ? window : null);
  try {
    const search = win?.location?.search;
    if (typeof search === 'string' && search) {
      const fromUrl = parseWorkerOverride(new URLSearchParams(search).get(GEOMETRY_WORKERS_QUERY_KEY));
      if (fromUrl) return fromUrl;
    }
  } catch (_) { /* no URL */ }
  try {
    const storage = env.storage || win?.localStorage;
    const fromStorage = parseWorkerOverride(storage?.getItem?.(GEOMETRY_WORKERS_STORAGE_KEY));
    if (fromStorage) return fromStorage;
  } catch (_) { /* storage blocked */ }
  return null;
}

/** The cap for the live page (or the `env` a test passes). */
export function liveGeometryWorkerCap(env = {}) {
  const nav = env.navigator || (typeof navigator !== 'undefined' ? navigator : null);
  return geometryWorkerCap({
    hardwareConcurrency: nav?.hardwareConcurrency,
    deviceMemory: nav?.deviceMemory,
    phone: detectPhoneClass(env),
    override: readGeometryWorkerOverride(env),
  });
}
