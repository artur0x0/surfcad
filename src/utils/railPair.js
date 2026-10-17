/**
 * Left CAD viewport rails (helper palette + contour mode) share one max-height
 * so they stop just below the part-name title chip. Height is **content-sized**
 * (`max-h` only): the rail is only as tall as its buttons need, and yields the
 * rest of the viewport. When the window is too short, the rail scrolls.
 *
 * **Height and scrolling are separate on purpose.** They used to be one class,
 * which made the RIGHT rail a scroll container too — and that broke two things
 * at once: it grew a scrollbar it never needed, and, because the view-snap
 * flyout is positioned OUTSIDE the rail box (`absolute right-full`), the
 * overflow clipped the flyout away entirely. Only rails that actually overflow
 * (the left tool palettes) may take RAIL_SCROLL_CLASS; the right rail stays
 * `overflow-visible` so the flyout can escape.
 */
import { useLayoutEffect, useRef, useState } from 'react';

/** Cap: up to just below the part-name chip; content shorter → rail shrinks. */
export const RAIL_PAIR_HEIGHT_CLASS = 'max-h-[min(26rem,calc(100%-5.5rem))]';

/**
 * Desktop left rail: full length instead of a 26rem block floating at the
 * bottom. Top sits one gap-2 (8px) below the horizontal feature strip
 * (title row at top-14 + ~2.5rem strip). Bottom matches other viewport chrome
 * (bottom-2.5). Phones keep RAIL_PAIR_HEIGHT_CLASS.
 */
export const RAIL_FULL_LENGTH_CLASS = 'top-[calc(3.5rem+2.5rem+0.5rem)] bottom-2.5';

/** data-rail-height for desktop full-length rails (goldens / playtest). */
export const RAIL_DESKTOP_FULL_ATTR = 'desktop-full';

/**
 * Position classes for a left viewport rail.
 * @param {{ desktopFull?: boolean }} o
 */
export function leftRailPositionClasses({ desktopFull = false } = {}) {
  if (desktopFull) return `${RAIL_FULL_LENGTH_CLASS} ${RAIL_SCROLL_CLASS}`;
  return `bottom-2.5 ${RAIL_PAIR_HEIGHT_CLASS} ${RAIL_SCROLL_CLASS}`;
}

/**
 * Left rails share one width so ContourModeRail matches HelperInsertPalette
 * (the Contour caption is longer than Block/Model/Polish/Move and used to
 * widen the contour rail past the parent). When buttons fit without scroll,
 * use the slightly narrower FIT width to yield space back to the viewport.
 */
export const RAIL_PAIR_WIDTH_CLASS = 'w-16';
export const RAIL_PAIR_WIDTH_FIT_CLASS = 'w-14';

/** Left rails only — they hold the whole tool list and genuinely overflow. */
export const RAIL_SCROLL_CLASS = 'overflow-y-auto overflow-x-hidden rail-scroll';

/** Right rail: same height, but nothing may clip the view-snap flyout. */
export const RAIL_NO_CLIP_CLASS = 'overflow-visible';

/** data-rail-height value goldens / playtest assert (content-sized max-h). */
export const RAIL_PAIR_HEIGHT_ATTR = 'content-max';

/**
 * Measure whether a left rail's buttons fit inside its max-height box.
 * When they fit (no scroll), return the narrower FIT width class.
 */
export function useLeftRailFit() {
  const railRef = useRef(null);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const el = railRef.current;
    if (!el) return undefined;
    const sync = () => {
      setFits(el.scrollHeight <= el.clientHeight + 1);
    };
    sync();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync);
      return () => window.removeEventListener('resize', sync);
    }
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return {
    railRef,
    fits,
    widthClass: fits ? RAIL_PAIR_WIDTH_FIT_CLASS : RAIL_PAIR_WIDTH_CLASS,
  };
}
