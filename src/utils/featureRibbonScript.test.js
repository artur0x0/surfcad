import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { composeHelperInsert, newPartStarterScript } from './helperPaletteSnippets.js';
import { parseFeatureMarkers } from './featureMarkers.js';
import { featureStripChips } from './sheetMetal/sheetRibbon.js';
import { featureRibbonScript } from './featureRibbonScript.js';
import { historyForPart } from './partHistory.js';

const STARTER = newPartStarterScript();
const APP = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');

test('agent create_part starter is a marked cube the ribbon can parse', () => {
  const chips = featureStripChips(STARTER);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].kind, 'cube');
  assert.equal(parseFeatureMarkers(STARTER).length, 1);
});

test('insert_cube on a starter keeps every feature in order', () => {
  const next = composeHelperInsert(STARTER, 'cube', null, {
    width: 12,
    depth: 12,
    height: 20,
  });
  const kinds = featureStripChips(next).map((chip) => chip.kind);
  assert.deepEqual(kinds, ['cube', 'cube']);
});

test('historyForPart seeds undo steps from agent-starter markers', () => {
  const history = historyForPart({}, 'local:pin', STARTER);
  assert.ok(history.head > 0);
  assert.equal(history.commits[history.head].code, STARTER);
  assert.match(history.commits[1].message, /cube/i);
});

test('joints mode blanks the ribbon even when the live script has markers', () => {
  assert.equal(
    featureRibbonScript({
      cadPartId: null,
      activeId: 'pin',
      currentScript: STARTER,
      partScripts: { pin: STARTER },
      showJoints: true,
    }),
    '',
  );
});

test('selecting the created part reveals stored markers when currentScript is still empty', () => {
  assert.equal(
    featureRibbonScript({
      cadPartId: 'pin',
      activeId: 'pin',
      currentScript: '',
      partScripts: { pin: STARTER },
      showJoints: false,
    }),
    STARTER,
  );
});

test('a highlighted non-active part reads its stored script', () => {
  const other = composeHelperInsert('', 'cylinder');
  assert.equal(
    featureRibbonScript({
      cadPartId: 'base',
      activeId: 'pin',
      currentScript: STARTER,
      partScripts: { base: other, pin: STARTER },
      showJoints: false,
    }),
    other,
  );
});

test('unmarked scripts still produce a Code chip on the ribbon', () => {
  const raw = 'let part = Manifold.cube([8, 8, 8], true);\nreturn part;\n';
  const chips = featureStripChips(raw);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].kind, 'code');
  assert.equal(chips[0].virtual, true);
});

test('App selects the part and syncs currentScript on agent create / open', () => {
  const add = APP.slice(APP.indexOf('const handleAddPart'), APP.indexOf('const handleDeletePart'));
  assert.match(add, /revealPartOnRibbon\(/);
  assert.match(APP, /finishOpenedPart[\s\S]*?revealPartOnRibbon\(active\.id/);
  const setEditor = APP.slice(APP.indexOf('setEditor(src)'), APP.indexOf('readHistory()'));
  assert.match(setEditor, /revealPartOnRibbon\(/);
  const openPart = APP.slice(APP.indexOf('const handleOpenVaultPart'), APP.indexOf('const handleCopyPartToAssembly'));
  assert.match(openPart, /revealPartOnRibbon\(/);
});

