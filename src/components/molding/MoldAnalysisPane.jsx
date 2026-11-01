/**
 * Scroll container for the molding results pane.
 * Phone CSS (`mold-analysis-pane` at max-width 768px) caps the height.
 * `useModalViewport` publishes visualViewport into `--modal-vvh`.
 */

import React, { forwardRef, useEffect, useRef } from 'react';
import { useModalViewport } from '../../hooks/useModalViewport';
import { bindMoldPaneGestures } from './moldPaneScroll';

const MoldAnalysisPane = forwardRef(function MoldAnalysisPane({ className = '', children, ...rest }, forwarded) {
  const ref = useRef(null);
  useModalViewport();
  useEffect(() => bindMoldPaneGestures(ref.current), []);
  const setRef = (node) => {
    ref.current = node;
    if (typeof forwarded === 'function') forwarded(node);
    else if (forwarded) forwarded.current = node;
  };
  const cls = className ? `mold-analysis-pane ${className}` : 'mold-analysis-pane';
  return (
    <div ref={setRef} data-mold-analysis-pane="" className={cls} {...rest}>
      {children}
    </div>
  );
});

export default MoldAnalysisPane;
