/**
 * Parts-list dirty dots. Editing one part dots only that row.
 * Saving it leaves every other part's real dirty state alone.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PartFeed from '../../src/components/PartFeed.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { GithubSessionProvider } from '../../src/hooks/useGithubSession.jsx';
import { feedRows } from '../../src/utils/assembly.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import { assemblyFilePath, sharedPartPath } from '../../src/utils/git/vaultLayout.js';
import { captureBaseline, dirtyPartIds } from '../../src/utils/git/gitWorkspace.js';
import { stringifySurfJson } from '../../src/utils/git/surfJson.js';
import { commitPartToRepo } from '../../src/utils/git/gitCommit.js';
import { partRowGitChrome } from '../../src/utils/git/gitAssemblyRename.js';

const SHEET = sharedPartPath('Sheet Metallica');
const LOFT = sharedPartPath('LoftZilla');
const BRACKET = sharedPartPath('Bracket');

const SHEET_TEXT = 'return Manifold.cube([40, 20, 1], true);\n';
const LOFT_TEXT = 'return Manifold.cube([10, 10, 30], true);\n';
const BRACKET_TEXT = 'return Manifold.cube([20, 8, 8], true);\n';

const BOX = {
  numProp: 3,
  vertProperties: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0],
  triVerts: [0, 1, 2, 0, 2, 3],
};

const RUNS = {
  [SHEET]: { ok: true, mesh: BOX, bodyCount: 1 },
  [LOFT]: { ok: true, mesh: BOX, bodyCount: 1 },
  [BRACKET]: { ok: true, mesh: BOX, bodyCount: 1 },
};

function makeDoc(activeId = BRACKET) {
  return {
    source: 'git',
    name: 'Metalll',
    activeId,
    parts: [
      { id: SHEET, name: 'Sheet Metallica', visible: false, order: 0 },
      { id: LOFT, name: 'LoftZilla', visible: false, order: 1 },
      { id: BRACKET, name: 'Bracket', visible: true, order: 2 },
    ],
  };
}

async function seedVault() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const doc = makeDoc();
  const scripts = {
    [SHEET]: SHEET_TEXT,
    [LOFT]: LOFT_TEXT,
    [BRACKET]: BRACKET_TEXT,
  };
  const seeded = await gh.commitFiles(vault.repo, {
    branch: 'main',
    message: 'seed',
    baseSha: vault.headSha,
    files: [
      fileWrite(assemblyFilePath('Metalll'), stringifySurfJson(doc)),
      fileWrite(SHEET, SHEET_TEXT),
      fileWrite(LOFT, LOFT_TEXT),
      fileWrite(BRACKET, BRACKET_TEXT),
    ],
  });
  const real = gh.commitFiles.bind(gh);
  gh.commitFiles = async (repo, body) => {
    const hold = window.__COMMIT_HOLD;
    if (hold && typeof hold.then === 'function') await hold;
    return real(repo, body);
  };
  const baseline = captureBaseline({
    assemblyPath: assemblyFilePath('Metalll'),
    assemblyName: 'Metalll',
    doc,
    scripts,
    branch: 'main',
    headSha: seeded.sha,
  });
  return { gh, repo: vault.repo, doc, scripts, baseline };
}

function rowsFor(doc, scripts, baseline, pendingId) {
  const dirty = dirtyPartIds(doc, scripts, baseline);
  return feedRows(doc, RUNS, scripts).map((row) => {
    const chrome = partRowGitChrome({
      inflight: pendingId === row.id,
      contentDirty: dirty.has(row.id),
    });
    return {
      ...row,
      dirty: chrome.dirty,
      pending: chrome.pending,
      syncFailed: chrome.syncFailed,
    };
  });
}

export function renderPartDirtyShot(el) {
  createRoot(el).render(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(GithubSessionProvider, null, React.createElement(Shot)),
    ),
  );
}

function Shot() {
  const [bundle, setBundle] = useState(null);
  const [scripts, setScripts] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const saveRef = useRef(async () => {});

  useEffect(() => {
    let cancel = false;
    seedVault().then((seeded) => {
      if (cancel) return;
      setBundle(seeded);
      setScripts(seeded.scripts);
      setBaseline(seeded.baseline);
      window.__IDS = { sheet: SHEET, loft: LOFT, bracket: BRACKET };
      window.__ORIGINAL = { [SHEET]: SHEET_TEXT, [LOFT]: LOFT_TEXT, [BRACKET]: BRACKET_TEXT };
      window.__READY__ = true;
    }).catch((err) => {
      window.__READY_ERROR = err?.message || String(err);
      window.__READY__ = true;
    });
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    window.__editPart = (id) => {
      setScripts((prev) => ({ ...prev, [id]: `${prev?.[id] || ''}\n// edited\n` }));
    };
    window.__savePart = (id) => saveRef.current(id);
    window.__readPart = async (id) => {
      if (!bundle) return '';
      const got = await bundle.gh.readFile(bundle.repo, id, 'main');
      return got?.content ?? '';
    };
  }, [bundle]);

  saveRef.current = async (id) => {
    if (!bundle || !scripts || !baseline) return { status: 'error' };
    setPendingId(id);
    try {
      const result = await commitPartToRepo(bundle.gh, bundle.repo, {
        doc: bundle.doc,
        scripts,
        baseline,
        partId: id,
      });
      window.__LAST_SAVE = result.status;
      if (result.baseline) setBaseline(result.baseline);
      if (result.scripts) setScripts(result.scripts);
      return result;
    } catch (err) {
      window.__SAVE_ERROR = err?.message || String(err);
      return { status: 'error', error: window.__SAVE_ERROR };
    } finally {
      setPendingId(null);
    }
  };

  if (!bundle || !scripts || !baseline) {
    return React.createElement('div', null, 'loading parts');
  }

  const doc = bundle.doc;
  const rows = rowsFor(doc, scripts, baseline, pendingId);
  window.__ROWS = rows.map((row) => ({
    id: row.id,
    dirty: row.dirty,
    pending: row.pending,
  }));
  const compact = typeof window !== 'undefined' && window.innerWidth < 500;

  return React.createElement(
    'div',
    { style: { width: '100%', height: '100vh', background: '#161616' } },
    React.createElement(PartFeed, {
      placement: compact ? 'mobile' : 'desktop',
      source: 'git',
      assemblyName: 'Metalll',
      currentBranch: 'main',
      rows,
      scripts,
      activeId: doc.activeId,
      onSelect: () => {},
      onAddToRepo: (id) => saveRef.current(id),
    }),
  );
}
