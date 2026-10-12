/**
 * Palette insert while the rollback bar is set. The new cube lands after
 * the fillet, the bar moves onto that cube, and the shell stays dim.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Viewport from '../../src/components/Viewport.jsx';
import FeatureStrip from '../../src/components/FeatureStrip.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { GithubSessionProvider } from '../../src/hooks/useGithubSession.jsx';
import { composeHelperInsert } from '../../src/utils/helperPaletteSnippets.js';
import {
  rollbackAnchorAfterInsert,
  rollbackInsertCaret,
} from '../../src/utils/featureSkip.js';
import manifoldContext from '../../src/utils/ManifoldWorker.js';

export function renderRollbackInsertShot(el, { compact = false, script = '' } = {}) {
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

function Shot({ compact, script: initialScript }) {
  const viewRef = useRef(null);
  const [script, setScript] = useState(initialScript);
  const [anchor, setAnchor] = useState('fillet1');
  const scriptRef = useRef(initialScript);
  scriptRef.current = script;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  const run = (source, nextAnchor) => viewRef.current?.executeScript?.(source, {
    rollbackAnchor: nextAnchor === undefined ? undefined : nextAnchor,
  });

  const onInsert = () => {
    const before = scriptRef.current;
    const stored = anchorRef.current;
    const caret = rollbackInsertCaret(before, stored);
    const next = composeHelperInsert(before, 'cube', caret, {
      width: 14,
      depth: 14,
      height: 40,
      center: true,
    });
    if (typeof next !== 'string') {
      window.__INSERT_ERROR__ = 'compose failed';
      window.__INSERT_DONE__ = 'error';
      return;
    }
    const nextAnchor = rollbackAnchorAfterInsert(before, next, stored);
    setScript(next);
    setAnchor(nextAnchor);
    scriptRef.current = next;
    anchorRef.current = nextAnchor;
    window.__INSERTED_SCRIPT__ = next;
    window.__NEW_ANCHOR__ = nextAnchor === null ? 'start' : (nextAnchor === undefined ? 'end' : nextAnchor);
    run(next, nextAnchor).then(async (ran) => {
      const anchored = meshSig();
      await run(next, undefined);
      const full = meshSig();
      await run(next, nextAnchor);
      window.__ANCHORED_SIG__ = anchored;
      window.__FULL_SIG__ = full;
      window.__INSERT_ERROR__ = ran ? '' : 'anchored run returned no mesh';
      window.__INSERT_DONE__ = window.__NEW_ANCHOR__;
    }).catch((err) => {
      window.__INSERT_ERROR__ = err?.message || String(err);
      window.__INSERT_DONE__ = 'error';
    });
  };

  useEffect(() => {
    let stop = false;
    window.__SCRIPT__ = initialScript;
    window.__INSERT_DONE__ = '';
    window.__MESH__ = false;
    (async () => {
      await manifoldContext.init();
      if (stop) return;
      let ran = false;
      for (let i = 0; i < 20 && !ran && !stop; i += 1) {
        ran = await run(initialScript, 'fillet1');
        if (!ran) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (stop) return;
      window.__PREFIX_SIG__ = meshSig();
      window.__MESH__ = !!(ran && window.__PREFIX_SIG__);
      if (!window.__MESH__) window.__MESH_ERROR__ = 'prefix run returned no mesh';
    })().catch((err) => {
      window.__MESH_ERROR__ = err?.message || String(err);
      window.__MESH__ = false;
    });
    return () => { stop = true; };
  }, [initialScript]);

  return React.createElement(
    'div',
    {
      'data-rollback-insert-shot': compact ? 'mobile' : 'desktop',
      style: { position: 'relative', width: '100%', height: '100vh', background: '#1e1e1e' },
    },
    React.createElement('button', {
      type: 'button',
      'data-rollback-insert': '',
      onClick: onInsert,
      style: {
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 50,
        minHeight: 44,
        minWidth: 44,
        padding: '0 12px',
      },
    }, 'Insert cube'),
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
        style: { position: 'absolute', left: 8, right: 8, bottom: 12, zIndex: 40 },
      },
      React.createElement(FeatureStrip, {
        orientation: 'horizontal',
        side: 'top',
        script,
        rollbackAnchor: anchor,
        onRollback: () => {},
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
