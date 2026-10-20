#!/usr/bin/env node
/**
 * Playtest Open lists. Folder → Part lists every part in the repo (each
 * assembly, including a legacy nested script, plus loose parts/), grouped
 * by source so same-name parts stay distinct. Folder → Assembly lists
 * assemblies only. Live search (filterVaultOpenIndex) filters both.
 * Opening: this assembly's own part, and a loose parts/ file, join by
 * reference. Another assembly's part is a linked reference (planOpenVaultPart).
 * Copy is explicit (Copy to this assembly), not a silent open. Mock only.
 */
import { readFileSync } from 'node:fs';
import { createMockGithubAdapter } from '../../src/utils/git/mockGithubAdapter.js';
import { findOrCreateVault } from '../../src/utils/git/vault.js';
import {
  assemblyFilePath, assemblyPartPath, legacyAssemblyPartPath, sharedPartPath,
} from '../../src/utils/git/vaultLayout.js';
import { stringifySurfJson } from '../../src/utils/git/surfJson.js';
import { fileWrite } from '../../src/utils/git/githubAdapterInterface.js';
import {
  listVaultBrowseItems,
  vaultOpenAssemblies,
  vaultOpenPartRows,
  groupVaultOpenPartRows,
  filterVaultOpenIndex,
  filterVaultPartItems,
  planOpenVaultPart,
  LOOSE_PARTS_LABEL,
} from '../../src/utils/git/gitWorkspace.js';

let failed = 0;
let passed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got); const w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}

const GB_BRACKET = assemblyPartPath('Gearbox', 'Bracket');
const GB_PLATE = assemblyPartPath('Gearbox', 'Plate');
const CV_BRACKET = assemblyPartPath('Cover', 'Bracket');
const CV_LID = assemblyPartPath('Cover', 'Lid');
const FR_RAIL = assemblyPartPath('Frame', 'Rail');
const FR_GUSSET = legacyAssemblyPartPath('Frame', 'Gusset');
const BOLT = sharedPartPath('M3 bolt');
const SHIM = sharedPartPath('Shim');

const BRACKET_A = 'return Manifold.cube([10,10,10], true); // gearbox';
const BRACKET_B = 'return Manifold.cube([12,8,4], true); // cover';

function asm(name, activeId, parts) {
  return stringifySurfJson({ source: 'git', name, activeId, parts });
}

async function seed() {
  const gh = createMockGithubAdapter({ login: 'artur' });
  const vault = await findOrCreateVault(gh);
  await gh.commitFiles(vault.repo, {
    branch: 'main', message: 'seed open lists', baseSha: vault.headSha,
    files: [
      fileWrite(assemblyFilePath('Gearbox'), asm('Gearbox', GB_BRACKET, [
        { id: GB_BRACKET, name: 'Bracket', visible: true, order: 0 },
        { id: BOLT, name: 'M3 bolt', visible: true, order: 1 },
      ])),
      fileWrite(GB_BRACKET, BRACKET_A),
      fileWrite(GB_PLATE, 'return Manifold.cube([30,20,2], true);'),
      fileWrite(assemblyFilePath('Cover'), asm('Cover', CV_LID, [
        { id: CV_BRACKET, name: 'Bracket', visible: true, order: 0 },
        { id: CV_LID, name: 'Lid', visible: true, order: 1 },
      ])),
      fileWrite(CV_BRACKET, BRACKET_B),
      fileWrite(CV_LID, 'return Manifold.cube([20,20,2], true);'),
      fileWrite(assemblyFilePath('Frame'), asm('Frame', FR_RAIL, [
        { id: FR_RAIL, name: 'Rail', visible: true, order: 0 },
        { id: FR_GUSSET, name: 'Gusset', visible: true, order: 1 },
      ])),
      fileWrite(FR_RAIL, 'return Manifold.cube([80,10,10], true);'),
      fileWrite(FR_GUSSET, 'return Manifold.cube([8,8,8], true);'),
      fileWrite(BOLT, 'return Manifold.cylinder(6, 1.5, 1.5, 24);'),
      fileWrite(SHIM, 'return Manifold.cube([15,15,0.5], true);'),
    ],
  });
  return { gh, repo: vault.repo };
}

const gearboxDoc = {
  source: 'git', name: 'Gearbox', activeId: GB_BRACKET,
  parts: [
    { id: GB_BRACKET, name: 'Bracket' },
    { id: BOLT, name: 'M3 bolt' },
  ],
};

console.log('git open lists — several assemblies + loose parts');
{
  const { gh, repo } = await seed();
  const browse = await listVaultBrowseItems(gh, repo, 'main');
  eq('assemblies', browse.assemblies.map((a) => a.name), ['Cover', 'Frame', 'Gearbox']);
  const partPaths = browse.parts.map((p) => p.path).sort();
  eq('every assembly part + loose parts', partPaths, [
    BOLT, SHIM, CV_BRACKET, CV_LID, FR_GUSSET, FR_RAIL, GB_BRACKET, GB_PLATE,
  ].sort());

  const assemblies = vaultOpenAssemblies(browse);
  eq('Open Assembly is assemblies only', assemblies.map((a) => a.name), ['Cover', 'Frame', 'Gearbox']);
  ok('Open Assembly carries no part paths', assemblies.every((a) => a.kind === 'assembly' && !a.path));
  const asmSearched = filterVaultOpenIndex({ assemblies, parts: [] }, 'cov');
  eq('Open Assembly search hits Cover only', asmSearched.assemblies.map((a) => a.name), ['Cover']);
  eq('Open Assembly search does not invent parts', asmSearched.parts, []);
  eq('Open Assembly search miss is empty', filterVaultOpenIndex({ assemblies, parts: [] }, 'lid').assemblies, []);
  eq('Open Assembly blank query is the full list',
    filterVaultOpenIndex({ assemblies, parts: [] }, '  ').assemblies.map((a) => a.name),
    ['Cover', 'Frame', 'Gearbox']);

  const rows = vaultOpenPartRows(browse.parts, {
    currentAssembly: 'Gearbox',
    inDoc: gearboxDoc.parts.map((p) => p.id),
  });
  ok('Open Part row count matches the repo', rows.length === browse.parts.length);
  const brackets = rows.filter((r) => r.name === 'Bracket');
  ok('same-name brackets are both labeled and marked',
    brackets.length === 2 && brackets.every((r) => r.sameName)
    && brackets.map((r) => r.source).sort().join(',') === 'Cover,Gearbox');
  ok('unique names are not flagged same-name', rows.filter((r) => r.name !== 'Bracket').every((r) => !r.sameName));
  const gusset = rows.find((r) => r.path === FR_GUSSET);
  ok('legacy nested part stays under its assembly', gusset && gusset.source === 'Frame' && gusset.foreign);

  const groups = groupVaultOpenPartRows(rows, { currentAssembly: 'Gearbox' });
  eq('group order: current, other assemblies A→Z, loose', groups.map((g) => g.label),
    ['Gearbox', 'Cover', 'Frame', LOOSE_PARTS_LABEL]);
  eq('current assembly parts', groups[0].parts.map((p) => p.name), ['Bracket', 'Plate']);
  ok('in-doc vs not, neither is foreign', groups[0].current
    && groups[0].parts.find((p) => p.name === 'Bracket').inDoc
    && !groups[0].parts.find((p) => p.name === 'Plate').inDoc
    && groups[0].parts.every((p) => !p.foreign));
  eq('Cover parts', groups[1].parts.map((p) => p.path), [CV_BRACKET, CV_LID]);
  ok('Cover parts would be linked', groups[1].parts.every((p) => p.foreign && !p.inDoc));
  eq('Frame includes the legacy gusset', groups[2].parts.map((p) => p.path), [FR_GUSSET, FR_RAIL]);
  eq('loose parts', groups[3].parts.map((p) => p.path), [BOLT, SHIM]);
  ok('loose bolt is in this assembly by reference', groups[3].loose
    && groups[3].parts.find((p) => p.path === BOLT).inDoc
    && groups[3].parts.every((p) => !p.foreign));

  const enriched = filterVaultOpenIndex({ assemblies: [], parts: rows }, 'bracket').parts;
  eq('search bracket finds both, still distinguishable',
    enriched.map((p) => `${p.source}/${p.name}`).sort(), ['Cover/Bracket', 'Gearbox/Bracket']);
  eq('search loose finds shared parts',
    filterVaultOpenIndex({ parts: rows }, 'loose').parts.map((p) => p.path).sort(), [BOLT, SHIM].sort());
  eq('search frame finds that assembly only',
    filterVaultPartItems(rows, 'frame').map((p) => p.path).sort(), [FR_GUSSET, FR_RAIL].sort());
  eq('search miss is empty', filterVaultOpenIndex({ parts: rows }, 'zzzz-no-such').parts, []);
  eq('blank search keeps every part', filterVaultOpenIndex({ parts: rows }, '  ').parts.length, rows.length);
  eq('raw index search loose still hits shared scope',
    filterVaultOpenIndex(browse, 'loose').parts.map((p) => p.path).sort(), [BOLT, SHIM].sort());

  eq('own in-doc part focuses', planOpenVaultPart(gearboxDoc, GB_BRACKET, BRACKET_A, {}),
    { id: GB_BRACKET, mode: 'focus' });
  eq('own part not in the doc is a reference', planOpenVaultPart(gearboxDoc, GB_PLATE, 'plate', {}),
    { id: GB_PLATE, mode: 'reference' });
  eq('loose part not in the doc is a reference', planOpenVaultPart(gearboxDoc, SHIM, 'shim', {}),
    { id: SHIM, mode: 'reference' });
  eq('loose part already in the doc focuses', planOpenVaultPart(gearboxDoc, BOLT, 'bolt', {}),
    { id: BOLT, mode: 'focus' });
  const linked = planOpenVaultPart(gearboxDoc, CV_BRACKET, BRACKET_B, { [GB_BRACKET]: BRACKET_A });
  eq('foreign part links at its own path', linked, { id: CV_BRACKET, mode: 'link' });
  ok('link path is the source', linked.id === CV_BRACKET);
  const again = planOpenVaultPart(
    { ...gearboxDoc, parts: [...gearboxDoc.parts, { id: CV_BRACKET, name: 'Bracket' }] },
    CV_BRACKET,
    BRACKET_B,
    { [GB_BRACKET]: BRACKET_A, [CV_BRACKET]: BRACKET_B },
  );
  eq('linked part already in the doc focuses', again, { id: CV_BRACKET, mode: 'focus' });
  const legacyLink = planOpenVaultPart(gearboxDoc, FR_GUSSET, 'gusset', {});
  eq('another assembly\'s legacy part links, it is not copied', legacyLink,
    { id: FR_GUSSET, mode: 'link' });
  const frameDoc = { source: 'git', name: 'Frame', parts: [{ id: FR_RAIL, name: 'Rail' }] };
  eq('legacy part of the current assembly is a reference',
    planOpenVaultPart(frameDoc, FR_GUSSET, 'gusset', {}),
    { id: FR_GUSSET, mode: 'reference' });
}

console.log('\ngit open lists — UI wiring');
{
  const feed = readFileSync(new URL('../../src/components/PartFeed.jsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  ok('folder Part and Assembly are separate pickers', /data-part-open-action="part"/.test(feed)
    && /data-part-open-action="assembly"/.test(feed)
    && /kind === 'open-part'/.test(feed) && /kind === 'open-assembly'/.test(feed)
    && /vaultOpenAssemblies/.test(feed) && /groupVaultOpenPartRows/.test(feed));
  ok('Open Part search uses filterVaultOpenIndex', /filterVaultOpenIndex\(\{ assemblies: \[\], parts: partRows \}/.test(feed)
    && /data-git-open-search/.test(feed) && /data-git-open-group/.test(feed)
    && /data-git-open-part-source/.test(feed));
  ok('Open Part subtitle comes from vaultOpenPartSubtitle (in this assembly / links from / parents)',
    /vaultOpenPartSubtitle\(item\)/.test(feed) && !/opens by reference/.test(feed));
  ok('App opens through planOpenVaultPart', /planOpenVaultPart\(/.test(app) && /handleOpenVaultPart/.test(app));
}

console.log(failed ? `\n❌ FAIL (${failed} failed, ${passed} passed)` : `\n✅ PASS (${passed})`);
process.exit(failed ? 1 : 0);
