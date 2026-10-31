/**
 * Scroll container for a molding legend, the DFM report, or the quote.
 * Phone CSS (`mold-analysis-pane` at max-width 768px) caps the height.
 * `useModalViewport` publishes visualViewport into `--modal-vvh`.
 */

import React, { useEffect, useRef } from 'react';
import { useModalViewport } from '../../hooks/useModalViewport';
import { bindMoldPaneGestures } from './moldPaneScroll';

export default function MoldAnalysisPane({ className = '', children, ...rest }) {
  const ref = useRef(null);
  useModalViewport();
  useEffect(() => bindMoldPaneGestures(ref.current), []);
  const cls = className ? `mold-analysis-pane ${className}` : 'mold-analysis-pane';
  return (
    <div ref={ref} data-mold-analysis-pane="" className={cls} {...rest}>
      {children}
    </div>
  );
}
