/**
 * The rollback bar and the run share one anchor through Accept, undo,
 * redo, delete, reload, and a part switch.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Viewport from '../../src/components/Viewport.jsx';
import FeatureStrip from '../../src/components/FeatureStrip.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { GithubSessionProvider } from '../../src/hooks/useGithubSession.jsx';
import { composeFilletCommit } from '../../src/utils/filletMode.js';
import {
  commitScriptAtRollback,
  resolveRollback,
  rollbackAnchorsAfterOpen,
} from '../../src/utils/featureSkip.js';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';
import { deleteFeatureBlock } from '../../src/utils/featureSheetWriteback.js';
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

export function renderRollbackSyncShot(el, { compact = false, script = '', otherScript = '' } = {}) {
  createRoot(el).render(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(
        GithubSessionProvider,
        null,
        React.createElement(Shot, { compact, script, otherScript }),
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

function Shot({ compact, script: initialScript, otherScript }) {
  const viewRef = useRef(null);
  const [script, setScript] = useState(initialScript);
  const [anchor, setAnchor] = useState('cube1');
  const scriptRef = useRef(initialScript);
  const anchorRef = useRef('cube1');
  const beforeRef = useRef(initialScript);
  const acceptedRef = useRef('');
  const filletRef = useRef('');

  const run = (source, nextAnchor) => viewRef.current?.executeScript?.(source, {
    rollbackAnchor: nextAnchor === undefined ? undefined : nextAnchor,
  });

  const publish = (token, source, nextAnchor, ran) => {
    const plan = resolveRollback(source, nextAnchor);
    window.__LAST__ = {
      token,
      ok: ran?.ok === true,
      sig: meshSig(),
      volume: Number.isFinite(ran?.volume) ? ran.volume : null,
      rolled: Array.isArray(ran?.rolledBack) ? ran.rolledBack : null,
      stored: nextAnchor === undefined ? undefined : nextAnchor,
      anchor: plan.anchor === null ? null : (plan.anchor || null),
      skipIds: plan.skipIds,
      index: plan.index,
      error: ran?.ok ? '' : 'run returned no mesh',
    };
    // `undefined` does not survive JSON-ish reads; the label is the contract.
    window.__LAST__.anchorLabel = plan.anchor === null ? 'start' : (typeof plan.anchor === 'string' ? plan.anchor : 'end');
    window.__STEP__ = token;
  };

  const show = async (source, nextAnchor, token) => {
    scriptRef.current = source;
    anchorRef.current = nextAnchor;
    setScript(source);
    setAnchor(nextAnchor);
    const ran = await run(source, nextAnchor);
    publish(token, source, nextAnchor, ran);
    return ran;
  };

  const onAccept = () => {
    const before = scriptRef.current;
    const composed = composeFilletCommit(before, {
      edges: [FILLET_EDGE],
      params: { radius: 2, strategy: 'sweep' },
      commitMode: 'append',
      filletClass: 'easy',
    });
    if (!composed?.ok || typeof composed.buffer !== 'string') {
      window.__LAST__ = { token: 'accept', error: composed?.message || 'compose failed', ok: false };
      window.__STEP__ = 'accept';
      return;
    }
    const placed = commitScriptAtRollback(before, composed.buffer, anchorRef.current);
    beforeRef.current = before;
    acceptedRef.current = placed.buffer;
    filletRef.current = placed.anchor;
    show(placed.buffer, placed.anchor, 'accept').catch((err) => {
      window.__LAST__ = { token: 'accept', error: err?.message || String(err), ok: false };
      window.__STEP__ = 'accept';
    });
  };

  const onUndo = () => {
    show(beforeRef.current, filletRef.current, 'undo').catch((err) => {
      window.__LAST__ = { token: 'undo', error: err?.message || String(err), ok: false };
      window.__STEP__ = 'undo';
    });
  };

  const onRedo = () => {
    show(acceptedRef.current, filletRef.current, 'redo').catch((err) => {
      window.__LAST__ = { token: 'redo', error: err?.message || String(err), ok: false };
      window.__STEP__ = 'redo';
    });
  };

  const onDelete = () => {
    const source = scriptRef.current;
    const feature = parseFeatureMarkers(source).find((item) => item.id === filletRef.current);
    const deleted = feature ? deleteFeatureBlock(source, feature) : { ok: false, message: 'missing fillet' };
    if (!deleted.ok) {
      window.__LAST__ = { token: 'delete', error: deleted.message || 'delete failed', ok: false };
      window.__STEP__ = 'delete';
      return;
    }
    show(deleted.buffer, filletRef.current, 'delete').catch((err) => {
      window.__LAST__ = { token: 'delete', error: err?.message || String(err), ok: false };
      window.__STEP__ = 'delete';
    });
  };

  const onReload = () => {
    rollbackAnchorsAfterOpen();
    show(scriptRef.current, undefined, 'reload').catch((err) => {
      window.__LAST__ = { token: 'reload', error: err?.message || String(err), ok: false };
      window.__STEP__ = 'reload';
    });
  };

  const onPartB = () => {
    show(otherScript, undefined, 'part-b').catch((err) => {
      window.__LAST__ = { token: 'part-b', error: err?.message || String(err), ok: false };
      window.__STEP__ = 'part-b';
    });
  };

  const onPartA = () => {
    show(initialScript, 'cube1', 'part-a').catch((err) => {
      window.__LAST__ = { token: 'part-a', error: err?.message || String(err), ok: false };
      window.__STEP__ = 'part-a';
    });
  };

  useEffect(() => {
    let stop = false;
    window.__RESOLVE__ = resolveRollback;
    window.__STEP__ = '';
    window.__MESH__ = false;
    (async () => {
      await manifoldContext.init();
      if (stop) return;
      let prefix = null;
      for (let i = 0; i < 20 && !prefix?.ok && !stop; i += 1) {
        prefix = await run(initialScript, 'cube1');
        if (!prefix?.ok) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (stop || !prefix?.ok) {
        window.__MESH_ERROR__ = 'prefix run returned no mesh';
        window.__MESH__ = false;
        return;
      }
      window.__PREFIX__ = {
        sig: meshSig(),
        volume: Number.isFinite(prefix.volume) ? prefix.volume : null,
        rolled: Array.isArray(prefix.rolledBack) ? prefix.rolledBack : null,
      };
      const full = await run(initialScript, undefined);
      window.__FULL__ = {
        ok: full?.ok === true,
        sig: meshSig(),
        volume: Number.isFinite(full?.volume) ? full.volume : null,
        rolled: Array.isArray(full?.rolledBack) ? full.rolledBack : null,
      };
      await run(initialScript, 'cube1');
      if (stop) return;
      publish('ready', initialScript, 'cube1', prefix);
      window.__MESH__ = !!(window.__PREFIX__.sig && window.__FULL__.sig);
      if (!window.__MESH__) window.__MESH_ERROR__ = 'full run returned no mesh';
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

  const button = (token, label, onClick) => React.createElement('button', {
    type: 'button',
    'data-rollback-sync': token,
    onClick,
    style: { minHeight: 44, minWidth: 44, padding: '0 10px' },
  }, label);

  return React.createElement(
    'div',
    {
      'data-rollback-sync-shot': compact ? 'mobile' : 'desktop',
      style: { position: 'relative', width: '100%', height: '100vh', background: '#1e1e1e' },
    },
    React.createElement('div', {
      style: {
        position: 'absolute',
        top: 8,
        left: 8,
        zIndex: 50,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        maxWidth: compact ? 280 : 720,
      },
    },
    button('accept', 'Accept', onAccept),
    button('undo', 'Undo', onUndo),
    button('redo', 'Redo', onRedo),
    button('delete', 'Delete', onDelete),
    button('reload', 'Reload', onReload),
    button('part-b', 'Part B', onPartB),
    button('part-a', 'Part A', onPartA),
    ),
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
