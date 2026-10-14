/**
 * A part-row Save advances only that part's baseline script.
 * Another part's real dirty state stays as it was. Mock adapter, no network.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileWrite } from '../src/utils/git/githubAdapterInterface.js';
import { createMockGithubAdapter } from '../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../src/utils/git/vault.js';
import { assemblyFilePath, sharedPartPath } from '../src/utils/git/vaultLayout.js';
import { captureBaseline, dirtyPartIds, isPartDirty } from '../src/utils/git/gitWorkspace.js';
import { stringifySurfJson } from '../src/utils/git/surfJson.js';
import {
  baselineAfterPartSave,
  commitPartToRepo,
  deletePartFromRepo,
} from '../src/utils/git/gitCommit.js';

const SHEET = sharedPartPath('Sheet Metallica');
const LOFT = sharedPartPath('LoftZilla');
const BRACKET = sharedPartPath('Bracket');

const SHEET_TEXT = 'return Manifold.cube([40, 20, 1], true);\n';
const LOFT_TEXT = 'return Manifold.cube([10, 10, 30], true);\n';
const BRACKET_TEXT = 'return Manifold.cube([20, 8, 8], true);\n';

function docOf(parts, activeId = BRACKET) {
  return {
    source: 'git',
    name: 'Metalll',
    activeId,
    parts,
  };
}

function partsOf(...ids) {
  return ids.map((id, order) => ({
    id,
    name: id.split('/').pop().replace(/\.js$/i, ''),
    visible: true,
    order,
  }));
}

async function seedThree() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  const doc = docOf(partsOf(SHEET, LOFT, BRACKET));
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

describe('part dirty baseline', () => {
  test('editing one part dirties only that part id', async () => {
    const { doc, scripts, baseline } = await seedThree();
    const edited = { ...scripts, [LOFT]: `${LOFT_TEXT}// loft edit\n` };
    assert.deepEqual([...dirtyPartIds(doc, edited, baseline)], [LOFT]);
    assert.equal(isPartDirty(SHEET, edited[SHEET], baseline), false);
    assert.equal(isPartDirty(BRACKET, edited[BRACKET], baseline), false);

    const live = dirtyPartIds(doc, scripts, baseline, {
      liveId: BRACKET,
      liveScript: `${BRACKET_TEXT}// typing in Bracket\n`,
    });
    assert.deepEqual([...live], [BRACKET]);
    assert.equal(live.has(LOFT), false);
    assert.equal(live.has(SHEET), false);
  });

  test('saving one part leaves a dirty sibling dirty and a clean sibling clean', async () => {
    const { gh, repo, doc, scripts, baseline } = await seedThree();
    const edited = {
      ...scripts,
      [LOFT]: `${LOFT_TEXT}// loft still unsaved\n`,
      [BRACKET]: `${BRACKET_TEXT}// bracket saved\n`,
    };
    assert.deepEqual([...dirtyPartIds(doc, edited, baseline)].sort(), [BRACKET, LOFT].sort());

    const saved = await commitPartToRepo(gh, repo, {
      doc,
      scripts: edited,
      baseline,
      partId: BRACKET,
    });
    assert.equal(saved.status, 'committed');
    assert.equal(saved.baseline.scripts[BRACKET], edited[BRACKET]);
    assert.equal(saved.baseline.scripts[LOFT], LOFT_TEXT);
    assert.equal(saved.baseline.scripts[SHEET], SHEET_TEXT);
    assert.equal((await gh.readFile(repo, BRACKET, 'main')).content, edited[BRACKET]);
    assert.equal((await gh.readFile(repo, LOFT, 'main')).content, LOFT_TEXT);
    assert.equal((await gh.readFile(repo, SHEET, 'main')).content, SHEET_TEXT);

    const after = dirtyPartIds(doc, edited, saved.baseline);
    assert.equal(after.has(BRACKET), false);
    assert.equal(after.has(LOFT), true);
    assert.equal(after.has(SHEET), false);
  });

  test('a new unsaved part stays dirty when another part is saved', async () => {
    const { gh, repo, doc, scripts, baseline } = await seedThree();
    const fresh = sharedPartPath('Fresh');
    const nextDoc = docOf([...doc.parts, { id: fresh, name: 'Fresh', visible: true, order: 3 }]);
    const edited = { ...scripts, [fresh]: 'return Manifold.cube([1, 1, 1], true);\n', [BRACKET]: `${BRACKET_TEXT}// saved\n` };
    const saved = await commitPartToRepo(gh, repo, {
      doc: nextDoc,
      scripts: edited,
      baseline,
      partId: BRACKET,
    });
    assert.equal(saved.status, 'committed');
    assert.equal(Object.prototype.hasOwnProperty.call(saved.baseline.scripts, fresh), false);
    assert.equal(isPartDirty(fresh, edited[fresh], saved.baseline), true);
    assert.equal(dirtyPartIds(nextDoc, edited, saved.baseline).has(BRACKET), false);
    assert.equal(dirtyPartIds(nextDoc, edited, saved.baseline).has(SHEET), false);
    assert.equal(dirtyPartIds(nextDoc, edited, saved.baseline).has(LOFT), false);
  });

  test('deleting one part does not adopt a sibling edit into the baseline', async () => {
    const { gh, repo, doc, scripts, baseline } = await seedThree();
    const edited = { ...scripts, [LOFT]: `${LOFT_TEXT}// still dirty\n` };
    const remaining = doc.parts.filter((part) => part.id !== SHEET);
    const nextDoc = docOf(remaining, LOFT);
    const removed = await deletePartFromRepo(gh, repo, {
      doc: nextDoc,
      scripts: edited,
      baseline,
      partPath: SHEET,
    });
    assert.equal(removed.status, 'committed');
    assert.equal(removed.baseline.scripts[LOFT], LOFT_TEXT);
    assert.equal(removed.baseline.scripts[BRACKET], BRACKET_TEXT);
    assert.equal(Object.prototype.hasOwnProperty.call(removed.baseline.scripts, SHEET), false);
    assert.equal(dirtyPartIds(nextDoc, edited, removed.baseline).has(LOFT), true);
    assert.equal(dirtyPartIds(nextDoc, edited, removed.baseline).has(BRACKET), false);
    assert.equal((await gh.readFile(repo, LOFT, 'main')).content, LOFT_TEXT);
  });

  test('baselineAfterPartSave does not invent an empty script for an unsaved part', () => {
    const doc = docOf(partsOf(SHEET, LOFT));
    const baseline = captureBaseline({
      assemblyPath: assemblyFilePath('Metalll'),
      assemblyName: 'Metalll',
      doc: docOf(partsOf(SHEET)),
      scripts: { [SHEET]: SHEET_TEXT },
      branch: 'main',
      headSha: 'abc',
    });
    const next = baselineAfterPartSave(baseline, {
      doc,
      saved: {},
      assemblyPath: assemblyFilePath('Metalll'),
      assemblyName: 'Metalll',
      assemblyWritten: false,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(next.scripts, LOFT), false);
    assert.equal(next.scripts[SHEET], SHEET_TEXT);
    assert.equal(isPartDirty(LOFT, '', next), true);
    assert.equal(next.assemblyText, baseline.assemblyText);
  });

  test('App adopts a flush baseline per saved part id', () => {
    const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    assert.match(app, /for \(const id of result\.partIds\)/);
    assert.match(app, /baselineAfterPartSave\(base,/);
    assert.doesNotMatch(
      app,
      /rememberGitBaseline\(captureBaseline\(\{[^}]*scripts: partScriptsRef\.current/,
    );
  });
});
