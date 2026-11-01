/**
 * One molding results pane. Pull, core and cavity, wall thickness,
 * mold draft, the DFM report, and the quote render as sections
 * inside it. The card is the feature-sheet shell. Its left and width are
 * the same rail measure the feature card uses, so the pane stays out of
 * both toolbars. Phone height and gestures stay on `mold-analysis-pane`.
 */

import React, { useEffect, useRef, useState } from 'react';
import { measureFeatureSheetWidth } from '../../utils/featureSheetLayout';
import MoldAnalysisPane from './MoldAnalysisPane';

export default function MoldResultsPane({ compact = false, children }) {
  const ref = useRef(null);
  const [frame, setFrame] = useState(null);

  useEffect(() => {
    const card = ref.current;
    const pane = card?.closest('.viewport-shell') || card?.offsetParent;
    if (!pane || typeof ResizeObserver !== 'function') return undefined;
    const measure = () => {
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setFrame(measureFeatureSheetWidth(pane, root, { fullLeft: false, compact }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    const left = pane.querySelector('[data-rail-pair="left"]');
    const right = pane.querySelector('[data-rail-pair="right"]');
    if (left) ro.observe(left);
    if (right) ro.observe(right);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [compact]);

  const placed = !!(frame && frame.width > 0);
  const stop = (event) => event.stopPropagation();
  return (
    <MoldAnalysisPane
      ref={ref}
      data-mold-results-pane=""
      data-mold-results-placed={placed ? '1' : '0'}
      className="mold-results-pane feature-sheet-card feature-sheet-scroll pointer-events-auto absolute z-20 overflow-y-auto rounded-xl border border-gray-500/50 px-3 py-2 font-ui text-on-dark shadow-lg surface-glass-chip"
      style={placed ? { left: `${frame.left}px`, width: `${frame.width}px`, right: 'auto', transform: 'none' } : undefined}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
    >
      {children}
    </MoldAnalysisPane>
  );
}
