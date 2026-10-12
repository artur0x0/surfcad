/**
 * Mid-chain feature skip. The viewport runs the failing script, keeps the
 * recovered solid, and the strip under the viewer marks the bad fillet and
 * the extrude that depends on it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Viewport from '../../src/components/Viewport.jsx';
import FeatureStrip from '../../src/components/FeatureStrip.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { GithubSessionProvider } from '../../src/hooks/useGithubSession.jsx';
import {
  failedFeatureFromOutcome,
  failedFeatureIds,
  failedFeatureTitles,
} from '../../src/utils/featureFailure.js';
import manifoldContext from '../../src/utils/ManifoldWorker.js';

export function renderFeatureSkipMidchainShot(el, { compact = false, script = '', control = '' } = {}) {
  createRoot(el).render(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(
        GithubSessionProvider,
        null,
        React.createElement(Shot, { compact, script, control }),
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

function Shot({ compact, script, control }) {
  const viewRef = useRef(null);
  const [failure, setFailure] = useState(null);

  useEffect(() => {
    let stop = false;
    window.__SCRIPT__ = script;
    window.__FAILURE__ = null;
    window.__MESH__ = false;
    (async () => {
      await manifoldContext.init();
      if (stop) return;
      let controlRan = false;
      for (let i = 0; i < 20 && !controlRan && !stop; i += 1) {
        controlRan = await viewRef.current?.executeScript?.(control);
        if (!controlRan) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (stop) return;
      const controlSig = meshSig();
      let ran = false;
      for (let i = 0; i < 4 && !ran && !stop; i += 1) {
        ran = await viewRef.current?.executeScript?.(script);
        if (!ran) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (stop) return;
      const midSig = meshSig();
      const verts = window.__VIEWPORT__?._lastRenderedMesh?.vertProperties;
      window.__CONTROL_SIG__ = controlSig;
      window.__MID_SIG__ = midSig;
      window.__VERTS__ = verts?.length || 0;
      window.__MESH__ = !!(ran && controlSig && midSig && controlSig === midSig && window.__FAILURE__);
      if (!window.__MESH__) {
        window.__MESH_ERROR__ = !ran
          ? 'executeScript did not return a mesh'
          : `geometry diverged control=${controlSig} mid=${midSig} failure=${!!window.__FAILURE__}`;
      }
    })().catch((err) => {
      window.__MESH_ERROR__ = err?.message || String(err);
      window.__MESH__ = false;
    });
    return () => { stop = true; };
  }, [script, control]);

  return React.createElement(
    'div',
    {
      'data-feature-skip-shot': compact ? 'mobile' : 'desktop',
      style: { position: 'relative', width: '100%', height: '100vh', background: '#1e1e1e' },
    },
    React.createElement(Viewport, {
      ref: viewRef,
      mode: 'cad',
      isMobile: compact,
      currentScript: script,
      currentFilename: 'Part (1)',
      assemblyName: 'Bracket',
      getHelperBuffer: () => script,
      onInsertHelper: () => {},
      onRunOutcome: (outcome) => {
        if (!outcome || outcome.ok) {
          window.__FAILURE__ = null;
          setFailure(null);
          return;
        }
        const hit = failedFeatureFromOutcome(outcome.script, outcome);
        const stored = hit
          ? { ...hit, skipped: Array.isArray(outcome.skipped) ? outcome.skipped : [] }
          : null;
        window.__FAILURE__ = stored;
        setFailure(stored);
      },
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
        failedIds: failedFeatureIds(script, failure),
        failedTitles: failedFeatureTitles(script, failure),
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
