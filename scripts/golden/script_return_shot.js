/**
 * A study comment sits after `return part;`. Fillet Accept must still land
 * before that return, and a script whose fillets were buried after the study
 * is repaired so those fillets run.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Viewport from '../../src/components/Viewport.jsx';
import FeatureStrip from '../../src/components/FeatureStrip.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { GithubSessionProvider } from '../../src/hooks/useGithubSession.jsx';
import { composeFeaStudy } from '../../src/fea/studyScript.js';
import { defaultStudy } from '../../src/fea/studySchema.js';
import { composeFilletCommit } from '../../src/utils/filletMode.js';
import {
  commitScriptAtRollback,
  featureBlocksAfterReturn,
  repairScriptReturns,
} from '../../src/utils/featureSkip.js';
import { parseFeatureMarkers } from '../../src/utils/featureMarkers.js';
import { markerWithId } from '../../src/utils/featureBlockId.js';
import { FILLET_MODE_BEGIN, FILLET_MODE_END } from '../../src/utils/helperPaletteSnippets.js';
import { findReturnPartIndex, splitScriptReturn } from '../../src/utils/scriptReturn.js';
import manifoldContext from '../../src/utils/ManifoldWorker.js';

const STUDY = { id: 's1', name: 'Bracket' };

const EDGE_A = {
  a: 4,
  b: 5,
  va: [10, -10, -10],
  vb: [10, -10, 10],
  boundaryId: 3,
  faceA: 0,
  faceB: 6,
  pairCount: 1,
};

const EDGE_B = {
  a: 2,
  b: 6,
  va: [-10, 10, -10],
  vb: [10, 10, -10],
  boundaryId: 5,
  faceA: 1,
  faceB: 5,
  pairCount: 1,
};

function filletCommit(buffer, edge, radius) {
  return composeFilletCommit(buffer, {
    edges: [edge],
    params: { radius, strategy: 'sweep' },
    commitMode: 'append',
    filletClass: 'easy',
  });
}

function retagFillet(block, id) {
  return String(block || '').split('\n').map((line) => {
    if (line.includes('fillet-mode begin')) return markerWithId(FILLET_MODE_BEGIN, id);
    if (line.includes('fillet-mode end')) return markerWithId(FILLET_MODE_END, id);
    return line;
  }).join('\n');
}

/** The Bracket shape: cube, return, study, two fillet blocks, a second return. */
function buryFilletsAfterStudy(script) {
  const features = parseFeatureMarkers(script).filter((feature) => feature.kind === 'fillet');
  const ids = ['selEdges1', 'selEdges5'];
  const chunks = features.map((feature, index) => retagFillet(
    script.slice(feature.startOffset, feature.endOffset).trim(),
    ids[index] || `selEdges${index + 1}`,
  ));
  let rest = script;
  for (let i = features.length - 1; i >= 0; i -= 1) {
    const feature = features[i];
    let cutStart = feature.startOffset;
    let cutEnd = feature.endOffset;
    if (rest[cutEnd] === '\n') cutEnd += 1;
    else if (cutStart > 0 && rest[cutStart - 1] === '\n') cutStart -= 1;
    rest = `${rest.slice(0, cutStart)}${rest.slice(cutEnd)}`;
  }
  const split = splitScriptReturn(rest);
  const study = split.tail.replace(/^\s+/, '');
  const head = split.head.replace(/\s*$/, '');
  const tail = study ? (study.endsWith('\n') ? study : `${study}\n`) : '';
  return `${head}\nreturn part;\n${tail}${chunks.join('\n')}\nreturn part;\n`;
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

export function renderScriptReturnShot(el, { compact = false, script = '' } = {}) {
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

function Shot({ compact, script: initialScript }) {
  const viewRef = useRef(null);
  const [script, setScript] = useState(initialScript);
  const scriptRef = useRef(initialScript);
  scriptRef.current = script;

  const run = (source) => viewRef.current?.executeScript?.(source, {});

  const onAccept = () => {
    const studied = composeFeaStudy(initialScript, defaultStudy(STUDY));
    const composed = filletCommit(studied, EDGE_A, 3.72);
    if (!composed?.ok || typeof composed.buffer !== 'string') {
      window.__ACCEPT_ERROR__ = composed?.message || 'compose failed';
      window.__ACCEPT_DONE__ = 'error';
      return;
    }
    const placed = commitScriptAtRollback(studied, composed.buffer, undefined);
    setScript(placed.buffer);
    run(placed.buffer).then((ran) => {
      const text = placed.buffer;
      const at = findReturnPartIndex(text);
      window.__ACCEPT_SCRIPT__ = text;
      window.__ACCEPT_RETURNS__ = (text.match(/return part;/g) || []).length;
      window.__ACCEPT_RETURN_AT__ = at;
      window.__ACCEPT_FILLET_AT__ = text.indexOf('fillet-mode begin');
      window.__ACCEPT_STUDY_AT__ = text.indexOf('fea-study begin');
      window.__ACCEPT_DEAD__ = featureBlocksAfterReturn(text).map((feature) => feature.id);
      window.__ACCEPT_SIG__ = meshSig();
      window.__ACCEPT_VOLUME__ = Number.isFinite(ran?.volume) ? ran.volume : null;
      window.__ACCEPT_OK__ = ran?.ok === true;
      window.__ACCEPT_ERROR__ = ran?.ok ? '' : 'fillet run returned no mesh';
      window.__ACCEPT_DONE__ = 'ok';
    }).catch((err) => {
      window.__ACCEPT_ERROR__ = err?.message || String(err);
      window.__ACCEPT_DONE__ = 'error';
    });
  };

  const onRepair = () => {
    const studied = composeFeaStudy(initialScript, defaultStudy(STUDY));
    const first = filletCommit(studied, EDGE_A, 3.72);
    if (!first?.ok) {
      window.__REPAIR_ERROR__ = first?.message || 'first fillet failed';
      window.__REPAIR_DONE__ = 'error';
      return;
    }
    const second = filletCommit(first.buffer, EDGE_B, 3.27);
    if (!second?.ok) {
      window.__REPAIR_ERROR__ = second?.message || 'second fillet failed';
      window.__REPAIR_DONE__ = 'error';
      return;
    }
    const broken = buryFilletsAfterStudy(second.buffer);
    run(broken).then(async (dead) => {
      const deadSig = meshSig();
      const repaired = repairScriptReturns(broken);
      setScript(repaired.buffer);
      const ran = await run(repaired.buffer);
      const text = repaired.buffer;
      const at = findReturnPartIndex(text);
      window.__BROKEN_SCRIPT__ = broken;
      window.__BROKEN_RETURNS__ = (broken.match(/return part;/g) || []).length;
      window.__BROKEN_DEAD__ = featureBlocksAfterReturn(broken).map((feature) => feature.id);
      window.__DEAD_SIG__ = deadSig;
      window.__DEAD_VOLUME__ = Number.isFinite(dead?.volume) ? dead.volume : null;
      window.__REPAIR_SCRIPT__ = text;
      window.__REPAIR_RETURNS__ = (text.match(/return part;/g) || []).length;
      window.__REPAIR_RETURN_AT__ = at;
      window.__REPAIR_MOVED__ = repaired.moved;
      window.__REPAIR_CHANGED__ = repaired.changed === true;
      window.__REPAIR_DEAD__ = featureBlocksAfterReturn(text).map((feature) => feature.id);
      window.__REPAIR_SEL1__ = text.indexOf('id=selEdges1');
      window.__REPAIR_SEL5__ = text.indexOf('id=selEdges5');
      window.__REPAIR_STUDY_AT__ = text.indexOf('fea-study begin');
      window.__REPAIR_SIG__ = meshSig();
      window.__REPAIR_VOLUME__ = Number.isFinite(ran?.volume) ? ran.volume : null;
      window.__REPAIR_OK__ = ran?.ok === true;
      window.__REPAIR_ERROR__ = ran?.ok ? '' : 'repaired run returned no mesh';
      window.__REPAIR_DONE__ = 'ok';
    }).catch((err) => {
      window.__REPAIR_ERROR__ = err?.message || String(err);
      window.__REPAIR_DONE__ = 'error';
    });
  };

  useEffect(() => {
    let stop = false;
    window.__ACCEPT_DONE__ = '';
    window.__REPAIR_DONE__ = '';
    window.__MESH__ = false;
    (async () => {
      await manifoldContext.init();
      if (stop) return;
      let ran = false;
      for (let i = 0; i < 20 && !ran && !stop; i += 1) {
        ran = await run(initialScript);
        if (!ran) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (stop) return;
      window.__PREFIX_SIG__ = meshSig();
      window.__PREFIX_VOLUME__ = Number.isFinite(ran?.volume) ? ran.volume : null;
      window.__MESH__ = !!(ran && window.__PREFIX_SIG__);
      if (!window.__MESH__) window.__MESH_ERROR__ = 'cube run returned no mesh';
    })().catch((err) => {
      window.__MESH_ERROR__ = err?.message || String(err);
      window.__MESH__ = false;
    });
    return () => { stop = true; };
  }, [initialScript]);

  const stripProps = {
    script,
    rollbackAnchor: undefined,
    onRollback: () => {},
    activeId: null,
    onJump: () => {},
    onUndo: () => {},
    onRedo: () => {},
    canUndo: false,
    canRedo: false,
  };

  const buttonStyle = {
    minHeight: 44,
    minWidth: 44,
    padding: '0 12px',
  };

  return React.createElement(
    'div',
    {
      'data-script-return-shot': compact ? 'mobile' : 'desktop',
      style: { position: 'relative', width: '100%', height: '100vh', background: '#1e1e1e' },
    },
    React.createElement('button', {
      type: 'button',
      'data-study-accept': '',
      onClick: onAccept,
      style: { ...buttonStyle, position: 'absolute', top: 12, left: 12, zIndex: 50 },
    }, 'Accept fillet'),
    React.createElement('button', {
      type: 'button',
      'data-script-repair': '',
      onClick: onRepair,
      style: { ...buttonStyle, position: 'absolute', top: 12, left: 160, zIndex: 50 },
    }, 'Repair script'),
    React.createElement(Viewport, {
      ref: viewRef,
      mode: 'cad',
      isMobile: compact,
      currentScript: script,
      currentFilename: 'Bracket',
      assemblyName: 'Bracket',
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
      React.createElement(FeatureStrip, { ...stripProps, orientation: 'horizontal', side: 'top' }),
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
      React.createElement(FeatureStrip, { ...stripProps, orientation: 'vertical', side: 'right' }),
    ),
  );
}
