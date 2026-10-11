/**
 * Temporary overlay visibility, one slot per toggle.
 *
 * begin(key) remembers the live value and forces that toggle on.
 * A second begin while the same key is already held does not replace
 * that memory. end(key) puts the remembered value back, unless choose()
 * ran while the hold was up — that tap is the user's value and stays.
 * Keys are independent: planes and sketches revert separately.
 *
 * Contour tools hold the keys they pick (holdContourOverlays) and
 * release them on the close path (releaseContourOverlays): Confirm, X,
 * Esc, and opening another tool all leave through exitContourMode.
 * The joints card holds planes the same way (holdJointPlanes) and
 * releases them when the card closes.
 */
import { useRef } from 'react';

export const OVERLAY_TOGGLE_KEYS = Object.freeze(['planes', 'contours']);

/**
 * Which overlays a contour entry picks.
 * Circle, rectangle, polygon, polyline, extrude, revolve, loft, and sweep
 * pick a plane and a saved sketch. Workplane picks a plane only.
 *
 * Cut, Draft, and Hole pick a face or an explicit world plane. Sheet metal
 * picks its own plane quads. None of those read these toggles, so they
 * do not hold them.
 */
export function overlayKeysForContourEntry(entry) {
  // Workplane is plane-only (same id isWorkplaneEntry checks). Kept here so
  // this module does not import the contour composer.
  if (entry === 'workplane') return ['planes'];
  return ['planes', 'contours'];
}

export function createTemporaryVisibility({ get, set }) {
  if (typeof get !== 'function' || typeof set !== 'function') {
    throw new Error('temporary visibility: get and set are required');
  }
  const slots = new Map();

  const read = (key) => {
    const value = get(key);
    if (typeof value !== 'boolean') {
      throw new Error(`temporary visibility: ${key} is not a boolean`);
    }
    return value;
  };

  return {
    begin(key) {
      const current = read(key);
      const slot = slots.get(key);
      if (slot?.held) {
        if (!slot.chosen) set(key, true);
        return;
      }
      slots.set(key, { held: true, baseline: current, chosen: false });
      set(key, true);
    },
    end(key) {
      const slot = slots.get(key);
      if (!slot?.held) return;
      if (!slot.chosen) set(key, slot.baseline);
      slots.delete(key);
    },
    choose(key, value) {
      const on = !!value;
      set(key, on);
      const slot = slots.get(key);
      if (slot?.held) slot.chosen = true;
    },
    isHeld(key) {
      return !!slots.get(key)?.held;
    },
  };
}

/** Drop any previous hold, then force on the keys this entry picks. */
export function holdContourOverlays(api, entry) {
  const need = new Set(overlayKeysForContourEntry(entry));
  for (const key of OVERLAY_TOGGLE_KEYS) {
    if (need.has(key)) {
      api.end(key);
      api.begin(key);
    } else {
      api.end(key);
    }
  }
}

export function releaseContourOverlays(api) {
  if (!api) return;
  for (const key of OVERLAY_TOGGLE_KEYS) api.end(key);
}

/** Joints card: planes on while it is open. Close restores the baseline. */
export function holdJointPlanes(api) {
  if (!api) return;
  api.begin('planes');
}

export function releaseJointPlanes(api) {
  if (!api) return;
  api.end('planes');
}

export function useTemporaryVisibility(toggles) {
  const togglesRef = useRef(toggles);
  togglesRef.current = toggles;
  const apiRef = useRef(null);
  if (!apiRef.current) {
    apiRef.current = createTemporaryVisibility({
      get: (key) => togglesRef.current[key].get(),
      set: (key, value) => togglesRef.current[key].set(value),
    });
  }
  return apiRef.current;
}
