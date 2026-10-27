/**
 * Releasing the rollback bar keeps the part selected. A tap on empty canvas,
 * away from the bar, is what reaches `onCadEmptyClick` (the app keeps the
 * part selected on that tap; this page clears it so the tap is visible).
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Viewport from '../../src/components/Viewport.jsx';
import FeatureStrip from '../../src/components/FeatureStrip.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { GithubSessionProvider } from '../../src/hooks/useGithubSession.jsx';
import manifoldContext from '../../src/utils/ManifoldWorker.js';

export function renderRollbackSelectShot(el, { compact = false, script = '', prefix = '' } = {}) {
  createRoot(el).render(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(
        GithubSessionProvider,
        null,
        React.createElement(Shot, { compact, script, prefix }),
      ),
    ),
  );
}

function meshSig() {
  const mesh = window.__VIEWPORT__?._lastRenderedMesh;
  const verts = mesh?.vertProperties;
  if (!verts || !verts.length) return '';
  let hash = verts.length;
  const step = Math.max(1, Math.floor(verts.length / 24));
  for (let i = 0; i < verts.length; i += step) {
    hash = (Math.imul(hash, 33) + Math.round(verts[i] * 1000)) | 0;
  }
  return `${verts.length}:${hash}`;
}

function Shot({ compact, script, prefix }) {
  const viewRef = useRef(null);
  const [anchor, setAnchor] = useState(undefined);
  const [partOn, setPartOn] = useState(true);

  const onRollback = (next) => {
    setAnchor(next);
    const label = next === undefined ? 'end' : (next === null ? 'start' : next);
    window.__ANCHOR__ = label;
    viewRef.current?.executeScript?.(script, {
      rollbackAnchor: next === undefined ? undefined : next,
    }).then(() => {
      window.__ROLLBACK_DONE__ = label;
    }).catch((err) => {
      window.__MESH_ERROR__ = err?.message || String(err);
      window.__ROLLBACK_DONE__ = label;
    });
  };

  const clearPart = () => {
    setPartOn(false);
    window.__PART__ = 'assembly';
  };

  useEffect(() => {
    let stop = false;
    window.__PART__ = 'part';
    window.__ROLLBACK_DONE__ = '';
    window.__MESH__ = false;
    (async () => {
      await manifoldContext.init();
      if (stop) return;
      let prefixRan = false;
      for (let i = 0; i < 20 && !prefixRan && !stop; i += 1) {
        prefixRan = await viewRef.current?.executeScript?.(prefix);
        if (!prefixRan) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (stop) return;
      let ran = false;
      for (let i = 0; i < 4 && !ran && !stop; i += 1) {
        ran = await viewRef.current?.executeScript?.(script);
        if (!ran) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (stop) return;
      window.__MESH__ = !!(prefixRan && ran && meshSig());
      if (!window.__MESH__) window.__MESH_ERROR__ = 'mesh did not build';
    })().catch((err) => {
      window.__MESH_ERROR__ = err?.message || String(err);
      window.__MESH__ = false;
    });
    return () => { stop = true; };
  }, [script, prefix]);

  return React.createElement(
    'div',
    {
      'data-rollback-select-shot': compact ? 'mobile' : 'desktop',
      style: { position: 'relative', width: '100%', height: '100vh', background: '#1e1e1e' },
    },
    React.createElement(Viewport, {
      ref: viewRef,
      mode: 'cad',
      isMobile: compact,
      currentScript: script,
      currentFilename: 'Part (1)',
      assemblyName: 'Bracket',
      rollbackAnchor: anchor,
      cadPartSelected: partOn,
      onCadEmptyClick: clearPart,
      getHelperBuffer: () => script,
      onInsertHelper: () => {},
      onUndo: () => {},
      canUndo: false,
      canRedo: false,
    }),
    React.createElement(
      'div',
      {
        'data-shot-feature-row': '1',
        style: { position: 'absolute', left: 8, right: 8, top: 80, zIndex: 40 },
      },
      React.createElement(FeatureStrip, {
        orientation: 'horizontal',
        side: 'top',
        script: partOn ? script : '',
        rollbackAnchor: anchor,
        onRollback,
        activeId: null,
        onJump: () => {},
        onUndo: () => {},
        onRedo: () => {},
        canUndo: false,
        canRedo: false,
      }),
    ),
  );
}
