/**
 * Rollback bar. The strip starts at the end. A drag to a gap rebuilds the
 * prefix and dims the tail. A drag back to the end restores the solid.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Viewport from '../../src/components/Viewport.jsx';
import FeatureStrip from '../../src/components/FeatureStrip.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { GithubSessionProvider } from '../../src/hooks/useGithubSession.jsx';
import manifoldContext from '../../src/utils/ManifoldWorker.js';

export function renderRollbackBarShot(el, { compact = false, script = '', prefix = '' } = {}) {
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

  const onRollback = (next) => {
    setAnchor(next);
    const label = next === undefined ? 'end' : (next === null ? 'start' : next);
    window.__ANCHOR__ = label;
    viewRef.current?.executeScript?.(script, {
      rollbackAnchor: next === undefined ? undefined : next,
    }).then((ran) => {
      window.__MESH_SIG__ = meshSig();
      window.__ROLLBACK_DONE__ = label;
      if (!ran) window.__MESH_ERROR__ = 'rollback run returned no mesh';
    }).catch((err) => {
      window.__MESH_ERROR__ = err?.message || String(err);
    });
  };

  useEffect(() => {
    let stop = false;
    window.__SCRIPT__ = script;
    window.__UNDO_CLICKS__ = 0;
    window.__MESH__ = false;
    window.__ROLLBACK_DONE__ = '';
    (async () => {
      await manifoldContext.init();
      if (stop) return;
      let prefixRan = false;
      for (let i = 0; i < 20 && !prefixRan && !stop; i += 1) {
        prefixRan = await viewRef.current?.executeScript?.(prefix);
        if (!prefixRan) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (stop) return;
      window.__PREFIX_SIG__ = meshSig();
      let ran = false;
      for (let i = 0; i < 4 && !ran && !stop; i += 1) {
        ran = await viewRef.current?.executeScript?.(script);
        if (!ran) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (stop) return;
      window.__FULL_SIG__ = meshSig();
      window.__MESH_SIG__ = window.__FULL_SIG__;
      window.__MESH__ = !!(prefixRan && ran && window.__PREFIX_SIG__ && window.__FULL_SIG__
        && window.__PREFIX_SIG__ !== window.__FULL_SIG__);
      if (!window.__MESH__) {
        window.__MESH_ERROR__ = `prefix ${window.__PREFIX_SIG__} full ${window.__FULL_SIG__}`;
      }
    })().catch((err) => {
      window.__MESH_ERROR__ = err?.message || String(err);
      window.__MESH__ = false;
    });
    return () => { stop = true; };
  }, [script, prefix]);

  return React.createElement(
    'div',
    {
      'data-rollback-shot': compact ? 'mobile' : 'desktop',
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
      getHelperBuffer: () => script,
      onInsertHelper: () => {},
      onUndo: () => { window.__UNDO_CLICKS__ += 1; },
      canUndo: false,
      canRedo: false,
    }),
    React.createElement(
      'div',
      {
        'data-shot-feature-row': '1',
        style: { position: 'absolute', left: 8, right: 8, bottom: 12, zIndex: 40 },
      },
      React.createElement(FeatureStrip, {
        orientation: 'horizontal',
        side: 'top',
        script,
        rollbackAnchor: anchor,
        onRollback,
        activeId: null,
        onJump: () => {},
        onUndo: () => { window.__UNDO_CLICKS__ += 1; },
        onRedo: () => {},
        canUndo: false,
        canRedo: false,
      }),
    ),
  );
}
