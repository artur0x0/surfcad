/**
 * Parts-list hide. The eye drops the part from the viewport solids.
 * The row thumbnail keeps the last successful mesh.
 */
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PartFeed from '../../src/components/PartFeed.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { GithubSessionProvider } from '../../src/hooks/useGithubSession.jsx';
import {
  composeViewportParts,
  feedRows,
  preserveHiddenPartRuns,
  setPartVisible,
} from '../../src/utils/assembly.js';

const BOX = {
  numProp: 3,
  vertProperties: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0],
  triVerts: [0, 1, 2, 0, 2, 3],
};
const WIDE = {
  numProp: 3,
  vertProperties: [20, 0, 0, 30, 0, 0, 30, 8, 0, 20, 8, 0],
  triVerts: [0, 1, 2, 0, 2, 3],
};

const INITIAL_DOC = {
  source: 'local',
  name: 'Bracket',
  activeId: 'box',
  parts: [
    { id: 'box', name: 'Box', visible: true, order: 0 },
    { id: 'wide', name: 'Wide', visible: true, order: 1 },
  ],
};
const INITIAL_RUNS = {
  box: { ok: true, mesh: BOX, bodyCount: 1 },
  wide: { ok: true, mesh: WIDE, bodyCount: 1 },
};
const SCRIPTS = {
  box: 'let part = box1;\nreturn part;\n',
  wide: 'let part = wide1;\nreturn part;\n',
};

/**
 * Same run map `refreshAssembly` builds: visible parts are re-run, a hidden
 * part is omitted, and a hidden active part is stored with a null mesh.
 * `preserveHiddenPartRuns` puts the last solid back for the thumbnail.
 */
function refreshAfterVisibility(doc, prevRuns) {
  const runs = {};
  const active = (doc.parts || []).find((part) => part.id === doc.activeId);
  for (const part of doc.parts || []) {
    if (part.visible === false || part.id === doc.activeId) continue;
    if (prevRuns[part.id]) runs[part.id] = prevRuns[part.id];
  }
  if (active && active.visible !== false && prevRuns[active.id]) {
    runs[active.id] = prevRuns[active.id];
  } else if (active) {
    runs[active.id] = {
      ok: false,
      mesh: null,
      skipped: active.visible === false,
      error: null,
    };
  }
  return preserveHiddenPartRuns(doc, runs, prevRuns);
}

function publish(doc, runs) {
  window.__DOC__ = doc;
  window.__RUNS__ = runs;
  window.__SOLIDS__ = composeViewportParts(doc, runs).map((solid) => solid.id);
  window.__ROWS__ = feedRows(doc, runs, SCRIPTS).map((row) => ({
    id: row.id,
    visible: row.visible,
    preview: row.mesh?.vertProperties ? 'manifold' : 'empty',
  }));
}

export function renderPartHideThumbnailShot(el) {
  createRoot(el).render(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(GithubSessionProvider, null, React.createElement(Shot)),
    ),
  );
}

function Shot() {
  const runsRef = useRef(INITIAL_RUNS);
  const [doc, setDoc] = useState(INITIAL_DOC);
  const [runs, setRuns] = useState(INITIAL_RUNS);
  publish(doc, runs);

  const onToggleVisible = (id) => {
    const part = doc.parts.find((row) => row.id === id);
    const next = setPartVisible(doc, id, part?.visible === false);
    const kept = refreshAfterVisibility(next, runsRef.current);
    runsRef.current = kept;
    setDoc(next);
    setRuns(kept);
    publish(next, kept);
  };

  const rows = feedRows(doc, runs, SCRIPTS);
  const solids = composeViewportParts(doc, runs);
  const compact = typeof window !== 'undefined' && window.innerWidth < 500;

  return React.createElement(
    'div',
    { style: { display: 'flex', width: '100%', height: '100vh', background: '#111' } },
    React.createElement(PartFeed, {
      placement: compact ? 'mobile' : 'desktop',
      source: 'local',
      assemblyName: 'Bracket',
      rows,
      activeId: doc.activeId,
      onToggleVisible,
      onSelect: () => {},
    }),
    React.createElement(
      'div',
      {
        'data-viewport-solids': solids.map((solid) => solid.id).join(','),
        style: { flex: 1, color: '#ddd', padding: 16 },
      },
      solids.length ? solids.map((solid) => solid.id).join(', ') : 'viewport empty',
    ),
  );
}
