/**
 * Feature-edit Delete. A feature another feature block uses asks
 * "Delete along with N features", then removes those blocks as one undo
 * step. A feature with no feature dependents deletes immediately. Either
 * way the toast says Deleted and offers Undo.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Viewport from '../../src/components/Viewport.jsx';
import FeatureStrip from '../../src/components/FeatureStrip.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { GithubSessionProvider } from '../../src/hooks/useGithubSession.jsx';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';
import { deleteFeatureEdit } from '../../src/utils/featureEdit.js';
import { historyForPart, pushPartHistory, undoPartHistory } from '../../src/utils/partHistory.js';
import manifoldContext from '../../src/utils/ManifoldWorker.js';

export const DELETE_SCRIPT = `// header comment
// --- cube begin ---
let box1 = Manifold.cube([40, 30, 20], true);
let part = box1;
// --- cube end ---
// kept between
// --- cylinder begin ---
let cyl1 = Manifold.cylinder(16, 5, 5, 24).translate([0, 0, 18]);
part = part.add(cyl1);
// --- cylinder end ---
// --- fillet-mode begin ---
const selEdges = edgesBetween(part, 0, 2); // boundary edge 1
const path = makeSweepPath(selEdges);
part = filletAlongPath(part, path, 1.5);
// --- fillet-mode end ---
return part;
`;

export function renderFeatureEditDeleteShot(el, { compact = false, script = DELETE_SCRIPT } = {}) {
  createRoot(el).render(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(GithubSessionProvider, null, React.createElement(Shot, { compact, initialScript: script })),
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

function Shot({ compact, initialScript }) {
  const viewRef = useRef(null);
  const scriptRef = useRef(initialScript);
  const historyRef = useRef(historyForPart({}, 'part-1', initialScript));
  const [script, setScript] = useState(initialScript);
  const [session, setSession] = useState(false);
  const [canUndo, setCanUndo] = useState(historyRef.current.head > 0);
  const originalSig = useRef('');

  const publish = (next, history) => {
    scriptRef.current = next;
    historyRef.current = history;
    setScript(next);
    setCanUndo(history.head > 0);
    window.__SCRIPT__ = next;
    window.__HISTORY_HEAD__ = history.head;
  };

  useEffect(() => {
    let stop = false;
    window.__SCRIPT__ = initialScript;
    window.__HISTORY_HEAD__ = historyRef.current.head;
    window.__MESH_SIG__ = () => meshSig();
    window.__OPEN_EDIT__ = (kind) => {
      const feature = parseFeatureMarkers(scriptRef.current).find((item) => item.kind === kind);
      if (!feature) return false;
      return viewRef.current?.beginFeatureEdit?.(feature, scriptRef.current) === true;
    };
    window.__UNDO__ = () => {
      const undone = undoPartHistory(historyRef.current);
      if (typeof undone.code !== 'string') return false;
      publish(undone.code, undone.history);
      viewRef.current?.executeScript?.(undone.code);
      return true;
    };
    (async () => {
      await manifoldContext.init();
      if (stop) return;
      let ran = false;
      for (let i = 0; i < 20 && !ran && !stop; i += 1) {
        ran = await viewRef.current?.executeScript?.(initialScript);
        if (!ran) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (stop) return;
      originalSig.current = meshSig();
      window.__ORIGINAL_SIG__ = originalSig.current;
      window.__MESH__ = !!ran && !!originalSig.current;
      if (!ran) window.__MESH_ERROR__ = 'executeScript did not return a mesh';
    })().catch((err) => {
      window.__MESH_ERROR__ = err?.message || String(err);
      window.__MESH__ = false;
    });
    return () => { stop = true; };
  }, [initialScript]);

  const onDelete = (feature, opts) => {
    const result = deleteFeatureEdit(scriptRef.current, feature, {
      withDependents: !!opts?.withDependents,
    });
    if (!result.ok) {
      window.__DELETE_ERROR__ = result.message || 'delete failed';
      return false;
    }
    const pushed = pushPartHistory(historyRef.current, result.buffer, `Delete ${feature.chipLabel || feature.kind}`);
    if (pushed.head !== historyRef.current.head + 1) {
      window.__DELETE_ERROR__ = 'delete was not one undo step';
      return false;
    }
    publish(result.buffer, pushed);
    window.__DELETE_ERROR__ = '';
    setTimeout(() => {
      viewRef.current?.executeScript?.(result.buffer);
    }, 0);
    return true;
  };

  return React.createElement(
    'div',
    {
      'data-feature-edit-delete-shot': compact ? 'mobile' : 'desktop',
      style: { position: 'relative', width: '100%', height: '100vh', background: '#1e1e1e' },
    },
    React.createElement(Viewport, {
      ref: viewRef,
      mode: 'cad',
      isMobile: compact,
      currentScript: script,
      currentFilename: 'Part (1)',
      assemblyName: 'Bracket',
      getHelperBuffer: () => scriptRef.current,
      onInsertHelper: () => {},
      onDeleteFeatureEdit: onDelete,
      onFeatureSessionChange: setSession,
      onUndo: () => window.__UNDO__?.(),
      canUndo,
      canRedo: false,
    }),
    session ? null : React.createElement(
      'div',
      {
        'data-shot-feature-row': '1',
        style: { position: 'absolute', left: 0, right: 0, top: 56, zIndex: 15 },
      },
      React.createElement(FeatureStrip, {
        orientation: 'horizontal',
        side: 'top',
        script,
        activeId: null,
        onJump: () => {},
        onUndo: () => window.__UNDO__?.(),
        onRedo: () => {},
        canUndo,
        canRedo: false,
      }),
    ),
  );
}
