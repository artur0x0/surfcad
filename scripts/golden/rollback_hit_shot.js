/**
 * Rollback triangle hit target. Both strips share the anchor. A drag from
 * the edge of the 44px box moves the bar. At the start, that box clears
 * the first chip and the chip still opens.
 */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import FeatureStrip from '../../src/components/FeatureStrip.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { GithubSessionProvider } from '../../src/hooks/useGithubSession.jsx';

export function renderRollbackHitShot(el, { compact = false, script = '' } = {}) {
  createRoot(el).render(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(
        GithubSessionProvider,
        null,
        React.createElement(Shot, { compact, script }),
      ),
    ),
  );
}

function anchorLabel(anchor) {
  if (anchor === null) return 'start';
  if (anchor === undefined) return 'end';
  return anchor;
}

function Shot({ compact, script }) {
  const [anchor, setAnchor] = useState(undefined);

  const onRollback = (next) => {
    setAnchor(next);
    window.__ANCHOR__ = anchorLabel(next);
    window.__ROLLBACK_DONE__ = window.__ANCHOR__;
  };
  const onJump = (feature) => {
    window.__JUMPED__ = feature?.id || '';
  };

  const stripProps = {
    script,
    rollbackAnchor: anchor,
    onRollback,
    activeId: null,
    onJump,
    onUndo: () => {},
    onRedo: () => {},
    canUndo: false,
    canRedo: false,
  };

  return React.createElement(
    'div',
    {
      'data-rollback-hit-shot': compact ? 'mobile' : 'desktop',
      style: { position: 'relative', width: '100%', height: '100vh', background: '#1e1e1e' },
    },
    React.createElement(
      'div',
      {
        'data-shot-feature-row': '1',
        style: { position: 'absolute', left: 8, right: 8, bottom: 12, zIndex: 40 },
      },
      React.createElement(FeatureStrip, {
        ...stripProps,
        orientation: 'horizontal',
        side: 'top',
      }),
    ),
    React.createElement(
      'div',
      {
        'data-shot-feature-rail': '1',
        style: {
          position: 'absolute',
          top: 72,
          right: 8,
          height: compact ? 280 : 420,
          width: 44,
          zIndex: 40,
          display: 'flex',
          flexDirection: 'column',
        },
      },
      React.createElement(FeatureStrip, {
        ...stripProps,
        orientation: 'vertical',
        side: 'right',
      }),
    ),
  );
}
