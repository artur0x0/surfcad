/**
 * Left CAD viewport rails (helper palette + contour mode) share one max-height
 * so they stop 10px below the CAD feature ribbon. Height is **content-sized**
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

/** Cap: 10px under the CAD feature ribbon; content shorter → rail shrinks. */
export const RAIL_PAIR_HEIGHT_CLASS = 'rail-max-below-strip';

/**
 * Desktop left rail: full length instead of a 26rem block floating at the
 * bottom. Top sits `--feature-strip-rail-gap` (10px) below the horizontal
 * feature strip (title row at top-14 + `--feature-strip-height`). Bottom
 * matches other viewport chrome (10px). Phones keep RAIL_PAIR_HEIGHT_CLASS.
 */
export const RAIL_FULL_LENGTH_CLASS = 'rail-full-below-strip';

/** Right view rail: same 10px ribbon clearance, no 26rem cap. */
export const RAIL_RIGHT_MAX_CLASS = 'rail-right-below-strip';

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

/** Right rail: same height, but nothing may clip the view-snap or molding flyout. */
export const RAIL_NO_CLIP_CLASS = 'overflow-visible';

/** data-rail-height value goldens / playtest assert (content-sized max-h). */
export const RAIL_PAIR_HEIGHT_ATTR = 'content-max';

/**
 * Measure whether a left rail's buttons fit inside its max-height box.
 * When they fit (no scroll), return the narrower FIT width class.
 *
 * A content-max left rail (phone) also takes the right rail's height as its
 * minimum, so the two bottom-anchored rails start at the same line. Without
 * it the shorter palette hung lower than the view rail; with its 26rem cap
 * it scrolled while the view rail stood taller. The minimum wins over the
 * cap on purpose: the right rail already fits under the ribbon, so a left
 * rail of the same height does too. Desktop full-length rails are pinned
 * at the top and skip this.
 */
export function useLeftRailFit() {
  const railRef = useRef(null);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const el = railRef.current;
    if (!el) return undefined;
    const rightRail = () => {
      if (!el.classList.contains(RAIL_PAIR_HEIGHT_CLASS)) return null;
      const pane = el.parentElement;
      return pane ? pane.querySelector('[data-rail-pair="right"]') : null;
    };
    const sync = () => {
      const right = rightRail();
      const h = right ? right.getBoundingClientRect().height : 0;
      const next = h > 0 ? `${Math.round(h)}px` : '';
      if (el.style.minHeight !== next) el.style.minHeight = next;
      setFits(el.scrollHeight <= el.clientHeight + 1);
    };
    sync();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync);
      return () => window.removeEventListener('resize', sync);
    }
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    const right = rightRail();
    if (right) ro.observe(right);
    return () => ro.disconnect();
  }, []);

  return {
    railRef,
    fits,
    widthClass: fits ? RAIL_PAIR_WIDTH_FIT_CLASS : RAIL_PAIR_WIDTH_CLASS,
  };
}
