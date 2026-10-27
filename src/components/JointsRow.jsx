import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Blocks, ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import { chipTone } from '../utils/featureChipTone';
import { featureBarWindowMode } from '../utils/featureBarLayout';
import { JointGlyph } from './JointGlyph';

/**
 * Per-part joints row (MVP 3, Half A).
 *
 * A second 46px bar directly under the horizontal feature strip, on desktop
 * and on the phone. It lists the joints that name the selected part, or
 * every assembly joint while the assembly itself is selected (the title
 * chip). The feature strip never swaps to joints any more.
 *
 * A chip is the type glyph plus `Type · Other part` (`Fixed` for a ground
 * joint; `Type · A ↔ B` in assembly scope). Values never show on a chip. A
 * broken or conflict joint keeps the red failed ring and adds a warning
 * glyph; the reason is the chip tooltip. An angle chip keeps its value in
 * `data-joint-value` for goldens only. Chips centre while they fit and
 * start-align once they overflow; each clipped end fades and shows a
 * chevron with the count of hidden chips.
 *
 * Same box and bar classes as the feature strip (`feature-strip-bar`,
 * `feature-strip-chip`), so the two rows read as one block. The row has no
 * Undo of its own: the strip buttons stay the one history control.
 */

const CHIP_BOX = 'relative shrink-0 rounded-lg p-1.5 feature-strip-chip box-border flex items-center justify-center border';
const LEAD_BOX = 'shrink-0 rounded-lg p-1.5 feature-strip-chip flex items-center justify-center';

function hiddenCounts(scroller, track) {
  if (!scroller || !track) return { left: 0, right: 0 };
  const box = scroller.getBoundingClientRect();
  let left = 0;
  let right = 0;
  for (const chip of track.querySelectorAll('[data-joint-id]')) {
    const r = chip.getBoundingClientRect();
    if (r.right <= box.left + 1) left += 1;
    else if (r.left >= box.right - 1) right += 1;
  }
  return { left, right };
}

export default function JointsRow({
  /** Rows from `jointRowChips`. */
  chips = [],
  /** 'part' lists the selected part's joints; 'assembly' lists them all. */
  scope = 'assembly',
  partName = '',
  /** Joint whose card is open. */
  activeJointId = null,
  onSelectJoint,
  /** Phone: glyph plus the other part only. */
  compact = false,
}) {
  const scrollRef = useRef(null);
  const trackRef = useRef(null);
  const [windowMode, setWindowMode] = useState('fit');
  const [hidden, setHidden] = useState({ left: 0, right: 0 });
  const list = Array.isArray(chips) ? chips : [];
  const count = list.length;

  const measure = useCallback(() => {
    const scroller = scrollRef.current;
    const track = trackRef.current;
    if (!scroller || !track) return;
    setWindowMode(featureBarWindowMode(track.scrollWidth, scroller.clientWidth));
    const next = hiddenCounts(scroller, track);
    setHidden((cur) => (cur.left === next.left && cur.right === next.right ? cur : next));
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, count, compact, scope]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(scroller);
    if (trackRef.current) ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, [measure]);

  const scrollBy = (sign) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollBy({ left: sign * Math.max(80, scroller.clientWidth * 0.8), behavior: 'smooth' });
  };

  const overflow = windowMode === 'tail';
  const caption = scope === 'part' ? 'No joints' : 'No assembly joints';
  const leadTitle = scope === 'part' ? `Joints on ${partName || 'this part'}` : 'Assembly joints';

  return (
    <div
      className="feature-strip-bar relative flex w-full min-w-0 flex-row items-center
        border border-t-0 border-chrome-border/40 bg-chrome-surface/70 surface-glass-chip"
      data-joints-row=""
      data-assembly-joints=""
      data-joints-row-scope={scope}
      data-joints-row-count={count}
      data-joints-row-empty={count === 0 ? '' : undefined}
      data-joints-row-window={overflow ? 'overflow' : 'fit'}
      role="navigation"
      aria-label={scope === 'part' ? `Joints on ${partName || 'the selected part'}` : 'Assembly joints'}
    >
      <div
        className="shrink-0 pl-[max(0.5rem,env(safe-area-inset-left))]"
        data-joints-row-lead=""
      >
        <div className={`${LEAD_BOX} text-chrome-secondary`} title={leadTitle} aria-hidden="true">
          <Blocks size={16} strokeWidth={2} />
        </div>
      </div>
      <div className="relative min-w-0 flex-1 px-3" data-joints-row-section="joints">
        <div
          ref={scrollRef}
          onScroll={measure}
          className={`flex flex-row items-center overflow-x-auto overflow-y-hidden rail-scroll py-1.5 ${
            overflow ? 'justify-start' : 'justify-center'
          }`}
          data-joints-row-scroller=""
        >
          <div
            ref={trackRef}
            className="relative flex w-max flex-row items-center gap-2"
            data-joints-row-track=""
          >
            {count === 0 && (
              <div
                className={`${CHIP_BOX} border-transparent px-2 text-[9px] text-chrome-secondary font-sans whitespace-nowrap`}
                data-joints-row-caption=""
              >
                {caption}
              </div>
            )}
            {list.map((chip) => {
              const invalid = !!chip.invalid;
              const active = activeJointId != null && chip.id === activeJointId;
              const label = compact ? (chip.shortLabel || chip.label) : chip.label;
              return (
                <button
                  key={chip.id}
                  type="button"
                  data-joint-id={chip.id}
                  data-joint-type={chip.type}
                  data-joint-status={chip.status || 'ok'}
                  data-joint-value={chip.type === 'angle' ? chip.value : undefined}
                  data-joint-chip=""
                  data-joint-name={chip.name || undefined}
                  data-ui-action="data-joint-chip"
                  aria-pressed={active}
                  aria-invalid={invalid || undefined}
                  title={chip.title || chip.name}
                  onClick={() => onSelectJoint?.(chip)}
                  className={`${CHIP_BOX} gap-1.5 px-2 transition-colors active:opacity-80 ${chipTone(active, false, invalid)}`}
                >
                  <JointGlyph type={chip.type} size={16} />
                  <span className="text-ui-xs font-sans leading-none whitespace-nowrap" data-joint-chip-label="">
                    {label}
                  </span>
                  {invalid && (
                    <TriangleAlert size={14} strokeWidth={2} className="text-red-400" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
        {hidden.left > 0 && (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-7 bg-gradient-to-r from-chrome-surface to-transparent"
              data-joints-row-fade="left"
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-md p-0.5 text-blue-400 hover:bg-chrome-border/60 active:opacity-80"
              title={`${hidden.left} more`}
              aria-label={`Scroll to ${hidden.left} earlier joint${hidden.left === 1 ? '' : 's'}`}
              data-joints-row-scroll="prev"
              data-joints-row-hidden={hidden.left}
              data-ui-action="data-joints-row-scroll-prev"
            >
              <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
              <span className="absolute -bottom-1.5 -left-1 rounded-full bg-chrome-border px-1 text-[9px] leading-3 text-chrome-text">
                +{hidden.left}
              </span>
            </button>
          </>
        )}
        {hidden.right > 0 && (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-7 bg-gradient-to-l from-chrome-surface to-transparent"
              data-joints-row-fade="right"
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => scrollBy(1)}
              className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-md p-0.5 text-blue-400 hover:bg-chrome-border/60 active:opacity-80"
              title={`${hidden.right} more`}
              aria-label={`Scroll to ${hidden.right} later joint${hidden.right === 1 ? '' : 's'}`}
              data-joints-row-scroll="next"
              data-joints-row-hidden={hidden.right}
              data-ui-action="data-joints-row-scroll-next"
            >
              <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
              <span className="absolute -bottom-1.5 -right-1 rounded-full bg-chrome-border px-1 text-[9px] leading-3 text-chrome-text">
                +{hidden.right}
              </span>
            </button>
          </>
        )}
      </div>
      <div className="shrink-0 pr-[max(0.5rem,env(safe-area-inset-right))]" data-joints-row-tail="" aria-hidden="true">
        <div className={LEAD_BOX}><span className="block w-4" /></div>
      </div>
    </div>
  );
}
