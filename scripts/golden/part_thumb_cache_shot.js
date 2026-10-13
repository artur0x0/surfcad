/**
 * Hidden parts that have never been in the CAD view still get thumbnails.
 * The bitmap is stored by part id and script hash. A reload paints it
 * from that cache and does not run the script again.
 */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PartFeed from '../../src/components/PartFeed.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { GithubSessionProvider } from '../../src/hooks/useGithubSession.jsx';
import { composeViewportParts, feedRows } from '../../src/utils/assembly.js';
import { partThumbnailExecCount, ensurePartThumbnails } from '../../src/utils/partThumbnails.js';
import {
  clearPartThumbnails,
  forgetPartThumbnails,
  getPartThumbnail,
} from '../../src/utils/partThumbnailStore.js';

const BRACKET_MESH = {
  numProp: 3,
  vertProperties: [0, 0, 0, 10, 0, 0, 10, 8, 4, 0, 8, 4],
  triVerts: [0, 1, 2, 0, 2, 3],
};

const SCRIPTS = {
  sheet: 'let part = Manifold.cube([40, 28, 2], true);\nreturn part;\n',
  loft: 'let part = Manifold.cube([14, 14, 36], true);\nreturn part;\n',
  bracket: 'let part = Manifold.cube([20, 16, 10], true);\nreturn part;\n',
};

const DOC = {
  source: 'local',
  name: 'Playtest',
  activeId: 'bracket',
  parts: [
    { id: 'sheet', name: 'Sheet Metallica', visible: false, order: 0 },
    { id: 'loft', name: 'LoftZilla', visible: false, order: 1 },
    { id: 'bracket', name: 'Bracket', visible: true, order: 2 },
  ],
};

const RUNS = {
  bracket: { ok: true, mesh: BRACKET_MESH, bodyCount: 1 },
};

function readRow(id) {
  const canvas = window.document.querySelector(`[data-part-row="${id}"] [data-part-thumbnail]`);
  if (!canvas) return null;
  let bright = 0;
  try {
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 140 && data[i + 1] > 140 && data[i + 2] > 120) bright += 1;
    }
  } catch {
    bright = 0;
  }
  return {
    preview: canvas.getAttribute('data-part-preview'),
    source: canvas.getAttribute('data-part-thumb-source'),
    bright,
  };
}

function publish() {
  window.__SOLIDS__ = composeViewportParts(DOC, RUNS).map((solid) => solid.id);
  window.__thumbExec = () => partThumbnailExecCount();
  window.__thumbState = () => ({
    exec: partThumbnailExecCount(),
    solids: window.__SOLIDS__ || [],
    sheet: readRow('sheet'),
    loft: readRow('loft'),
    bracket: readRow('bracket'),
  });
  window.__forgetPartThumb = (id) => forgetPartThumbnails(id);
  window.__thumbUrl = (id) => getPartThumbnail(id, SCRIPTS[id]);
}

export async function renderPartThumbCacheShot(el) {
  if (window.sessionStorage.getItem('surfcad-thumb-golden') !== '1') {
    await clearPartThumbnails();
    window.sessionStorage.setItem('surfcad-thumb-golden', '1');
  }
  publish();
  createRoot(el).render(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(GithubSessionProvider, null, React.createElement(Shot)),
    ),
  );
  window.__READY__ = true;
}

function Shot() {
  const [doc] = useState(DOC);
  const [runs] = useState(RUNS);
  publish();

  useEffect(() => {
    let cancel = false;
    ensurePartThumbnails({
      parts: doc.parts,
      scripts: SCRIPTS,
      runs,
    }).catch((err) => {
      if (!cancel) window.console.warn('[thumb golden]', err?.message || err);
    });
    return () => { cancel = true; };
  }, [doc, runs]);

  const rows = feedRows(doc, runs, SCRIPTS);
  const solids = composeViewportParts(doc, runs);
  const compact = window.innerWidth < 500;

  return React.createElement(
    'div',
    { style: { display: 'flex', width: '100%', height: '100vh', background: '#111' } },
    React.createElement(PartFeed, {
      placement: compact ? 'mobile' : 'desktop',
      source: 'local',
      assemblyName: 'Playtest',
      rows,
      scripts: SCRIPTS,
      activeId: doc.activeId,
      onToggleVisible: () => {},
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
