/**
 * Fillet Accept while the rollback bar sits after the cube. The new fillet
 * lands in that gap, the bar moves onto it, and the shell stays grey.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Viewport from '../../src/components/Viewport.jsx';
import FeatureStrip from '../../src/components/FeatureStrip.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { GithubSessionProvider } from '../../src/hooks/useGithubSession.jsx';
import { composeFilletCommit } from '../../src/utils/filletMode.js';
import { commitScriptAtRollback } from '../../src/utils/featureSkip.js';
import manifoldContext from '../../src/utils/ManifoldWorker.js';

const FILLET_EDGE = {
  a: 0,
  b: 1,
  va: [0, 0, 0],
  vb: [0, 0, 20],
  boundaryId: 0,
  faceA: 0,
  faceB: 6,
  pairCount: 1,
};

export function renderRollbackAcceptShot(el, { compact = false, script = '' } = {}) {
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

function anchorLabel(anchor) {
  if (anchor === null) return 'start';
  if (anchor === undefined) return 'end';
  return anchor;
}

function Shot({ compact, script: initialScript }) {
  const viewRef = useRef(null);
  const [script, setScript] = useState(initialScript);
  const [anchor, setAnchor] = useState('cube1');
  const scriptRef = useRef(initialScript);
  scriptRef.current = script;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  const run = (source, nextAnchor) => viewRef.current?.executeScript?.(source, {
    rollbackAnchor: nextAnchor === undefined ? undefined : nextAnchor,
  });

  const onAccept = () => {
    const before = scriptRef.current;
    const stored = anchorRef.current;
    const composed = composeFilletCommit(before, {
      edges: [FILLET_EDGE],
      params: { radius: 2, strategy: 'sweep' },
      commitMode: 'append',
      filletClass: 'easy',
    });
    if (!composed?.ok || typeof composed.buffer !== 'string') {
      window.__ACCEPT_ERROR__ = composed?.message || 'compose failed';
      window.__ACCEPT_DONE__ = 'error';
      return;
    }
    const placed = commitScriptAtRollback(before, composed.buffer, stored);
    setScript(placed.buffer);
    setAnchor(placed.anchor);
    scriptRef.current = placed.buffer;
    anchorRef.current = placed.anchor;
    window.__ACCEPTED_SCRIPT__ = placed.buffer;
    window.__NEW_ANCHOR__ = anchorLabel(placed.anchor);
    run(placed.buffer, placed.anchor).then(async (ran) => {
      window.__ACCEPT_SIG__ = meshSig();
      window.__ACCEPT_VOLUME__ = Number.isFinite(ran?.volume) ? ran.volume : null;
      window.__ACCEPT_ROLLED__ = Array.isArray(ran?.rolledBack) ? ran.rolledBack : null;
      window.__ACCEPT_OK__ = ran?.ok === true;
      try {
        await run(placed.buffer, undefined);
        window.__FULL_SIG__ = meshSig();
      } catch (err) {
        window.__FULL_SIG__ = '';
        window.__FULL_ERROR__ = err?.message || String(err);
      }
      await run(placed.buffer, placed.anchor);
      window.__ACCEPT_ERROR__ = ran?.ok ? '' : 'anchored run returned no mesh';
      window.__ACCEPT_DONE__ = window.__NEW_ANCHOR__;
    }).catch((err) => {
      window.__ACCEPT_ERROR__ = err?.message || String(err);
      window.__ACCEPT_DONE__ = 'error';
    });
  };

  useEffect(() => {
    let stop = false;
    window.__SCRIPT__ = initialScript;
    window.__ACCEPT_DONE__ = '';
    window.__MESH__ = false;
    (async () => {
      await manifoldContext.init();
      if (stop) return;
      let ran = false;
      for (let i = 0; i < 20 && !ran && !stop; i += 1) {
        ran = await run(initialScript, 'cube1');
        if (!ran) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (stop) return;
      window.__PREFIX_SIG__ = meshSig();
      window.__PREFIX_VOLUME__ = Number.isFinite(ran?.volume) ? ran.volume : null;
      window.__PREFIX_ROLLED__ = Array.isArray(ran?.rolledBack) ? ran.rolledBack : null;
      window.__MESH__ = !!(ran && window.__PREFIX_SIG__);
      if (!window.__MESH__) window.__MESH_ERROR__ = 'prefix run returned no mesh';
    })().catch((err) => {
      window.__MESH_ERROR__ = err?.message || String(err);
      window.__MESH__ = false;
    });
    return () => { stop = true; };
  }, [initialScript]);

  const stripProps = {
    script,
    rollbackAnchor: anchor,
    onRollback: () => {},
    activeId: null,
    onJump: () => {},
    onUndo: () => {},
    onRedo: () => {},
    canUndo: false,
    canRedo: false,
  };

  return React.createElement(
    'div',
    {
      'data-rollback-accept-shot': compact ? 'mobile' : 'desktop',
      style: { position: 'relative', width: '100%', height: '100vh', background: '#1e1e1e' },
    },
    React.createElement('button', {
      type: 'button',
      'data-rollback-accept': '',
      onClick: onAccept,
      style: {
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 50,
        minHeight: 44,
        minWidth: 44,
        padding: '0 12px',
      },
    }, 'Accept fillet'),
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
      onUndo: () => {},
      canUndo: false,
      canRedo: false,
    }),
    React.createElement(
      'div',
      {
        'data-shot-feature-row': '1',
        style: { position: 'absolute', left: 8, right: 64, bottom: 12, zIndex: 40 },
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
