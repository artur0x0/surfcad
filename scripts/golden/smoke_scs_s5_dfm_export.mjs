#!/usr/bin/env node
/**
 * SCS S5 — DFM + export. Hard DFM fails block the SendCutSend handoff; soft
 * issues warn. Flat pattern (BA unfold) → cut-only DXF (mm); the spec → exact
 * STEP B-rep (smoke_scs_true_curve_step); the mesh writer stays as the
 * fallback and is still checked here. Order opens app.sendcutsend.com from
 * ScsHandoff, not from the Check card.
 */
import { readFileSync } from 'node:fs';
import { joinScsCatalog, findScsSku, SCS_ORDER_URL } from '../../src/utils/scs/scsCatalog.js';
import {
  acceptBaseFlange,
  closeSheetExport,
  enterSheetMetalMode,
  openSheetExport,
  pickSheetPlane,
  setSheetTool,
  sheetTap,
} from '../../src/utils/sheetMetal/sheetMetalMode.js';
import { bendAllowance, cornerReliefSize, createSheetSpec } from '../../src/utils/sheetMetal/sheetModel.js';
import { checkSheetDfm } from '../../src/utils/sheetMetal/sheetDfm.js';
import { sheetFlatDxf, sheetFlatPattern } from '../../src/utils/sheetMetal/sheetFlat.js';
import { meshPlanarFaces, meshToStep } from '../../src/utils/sheetMetal/stepExport.js';
import { buildSheetExport, meshVolume, sheetExpectedVolume, sheetFileBase } from '../../src/utils/sheetMetal/sheetExport.js';
import { sheetMetalBlock } from '../../src/utils/sheetMetal/sheetMetalScript.js';
import { loadSandbox } from './scs_sandbox.mjs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const fixture = (name) => JSON.parse(read(`scripts/golden/fixtures/scs/${name}.json`));
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const { records } = joinScsCatalog(fixture('catalog'), fixture('specs'));
const alu = findScsSku(records, 'ALU-090');
const al6061 = findScsSku(records, 'ALU6061-100');
const base = () => createSheetSpec(alu, 'XY');
const rules = (spec, level) => checkSheetDfm(spec).issues.filter((i) => !level || i.level === level).map((i) => i.rule);

console.log('SCS S5 — DFM rules (ALU-090 limits)');
{
  const L = base().limits;
  check('clean base flange passes', checkSheetDfm(base()).ok && checkSheetDfm(base()).issues.length === 0);
  const tiny = { ...base(), holes: [{ id: 'h1', panel: 'base', u: 0, v: 0, d: L.minHole * 0.5 }] };
  check('hole below SCS min Ø → fail', rules(tiny, 'fail').includes('min-hole'));
  const pair = (gap) => ({ ...base(), holes: [{ id: 'h1', panel: 'base', u: 0, v: 0, d: 5 }, { id: 'h2', panel: 'base', u: 5 + gap, v: 0, d: 5 }] });
  check('bridge below SCS min → fail', rules(pair(L.minBridge * 0.5), 'fail').includes('bridge'));
  check('bridge at SCS min → ok', !rules(pair(L.minBridge + 0.01)).includes('bridge'));
  check('overlapping holes → fail', rules(pair(-1), 'fail').includes('bridge'));
  const nearEdge = { ...base(), holes: [{ id: 'h1', panel: 'base', u: 50 - 2.5 - L.minHoleToEdge * 0.5, v: 0, d: 5 }] };
  check('hole too close to a free edge → fail', rules(nearEdge, 'fail').includes('hole-edge'));
  const out = { ...base(), holes: [{ id: 'h1', panel: 'base', u: 49, v: 0, d: 5 }] };
  check('hole breaking out of the face → fail', rules(out, 'fail').includes('hole-edge'));
  const underTab = { ...nearEdge, tabs: [{ id: 't1', panel: 'base', edge: 'u+', width: 30, depth: 10, centered: true }] };
  check('a tab covering that edge span lifts hole-edge', !rules(underTab).includes('hole-edge'));
  const bent = { ...base(), bends: [{ id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 20 }] };
  const nearBend = { ...bent, holes: [{ id: 'h1', panel: 'base', u: 50 - 2.5 - 3, v: 0, d: 5 }] };
  check('plain hole near a bend → soft warn (not fail)', rules(nearBend, 'warn').includes('hole-bend') && checkSheetDfm(nearBend).ok);
  const inchTiny = checkSheetDfm(tiny, { unit: 'in' });
  check('DFM text follows the display unit; the spec stays mm',
    inchTiny.issues.some((i) => i.rule === 'min-hole' && /\d+\.\d+ in/.test(i.message))
    && checkSheetDfm(tiny).issues.some((i) => i.rule === 'min-hole' && /\d+\.\d+ mm/.test(i.message))
    && tiny.width === 100);
  const tappedNear = { ...bent, holes: [{ id: 'h1', panel: 'base', u: 50 - 6, v: 0, d: 3.3, type: 'tapped', thread: 'M4' }] };
  check('tapped hole inside SCS centre→bend-line min → fail', L.minHoleToBend > 6 && rules(tappedNear, 'fail').includes('hole-bend'));
  const flangeHole = { ...bent, holes: [{ id: 'h1', panel: 'b1', u: 1.5, v: 0, d: 2 }] };
  check('hole on a flange next to its own bend → warn', rules(flangeHole, 'warn').includes('hole-bend'));
  const short = { ...base(), bends: [{ id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: L.minFlange - 1 }] };
  check('flange below SCS min → fail', rules(short, 'fail').includes('flange'));
  const steep = { ...base(), bends: [{ id: 'b1', panel: 'base', edge: 'u+', angle: L.maxAngle + 10, length: 20 }] };
  check('angle above SCS max → fail', rules(steep, 'fail').includes('angle'));
  const notBendable = { ...createSheetSpec(al6061, 'XY'), bends: [{ id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 20 }] };
  check('bends on a non-bending SKU → fail', rules(notBendable, 'fail').includes('no-bending'));
  const huge = { ...base(), width: 1150, height: 100 };
  check('flat bigger than SCS max → fail', rules(huge, 'fail').includes('flat-size'));
  const longBend = { ...base(), width: 1110, height: 100, bends: [{ id: 'b1', panel: 'base', edge: 'v+', angle: 90, length: 10 }] };
  const lim = { ...longBend, limits: { ...longBend.limits, maxBendLength: 500 } };
  check('bend line over SCS max length → fail', rules(lim, 'fail').includes('bend-length'));
  const smallTab = { ...base(), tabs: [{ id: 't1', panel: 'base', edge: 'u+', width: 0.5, depth: 10, centered: true }] };
  check('tiny tab → warn only', rules(smallTab, 'warn').includes('tab-small') && checkSheetDfm(smallTab).ok);
}

console.log('SCS S5 — flat pattern + DXF');
const tray = {
  ...base(),
  bends: [{ id: 'b1', panel: 'base', edge: 'u+', angle: 90, length: 20 }, { id: 'b2', panel: 'base', edge: 'v+', angle: 90, length: 20 }],
  tabs: [{ id: 't1', panel: 'base', edge: 'u-', width: 20, depth: 10, centered: true }],
  holes: [{ id: 'h1', panel: 'base', u: 0, v: 0, d: 6 }, { id: 'h2', panel: 'b1', u: 12, v: 0, d: 4 }],
};
const flat = sheetFlatPattern(tray);
{
  const ba = bendAllowance(tray, 90);
  const g = cornerReliefSize(tray);
  check('one outline loop (bent flanges + tab + relief notch)', flat.outline.length === 1, String(flat.outline.length));
  check('flat X = tab + base + BA + flange', near(flat.size[0], 10 + 100 + ba + 20), String(flat.size[0]));
  check('flat Y = base + BA + flange', near(flat.size[1], 60 + ba + 20), String(flat.size[1]));
  const want = 100 * 60 + 2 * ba * 0 + (60 - g) * (ba + 20) + (100 - g) * (ba + 20) + 20 * 10 - g * g;
  check('outline area = base + strips + flanges + tab − notch', near(flat.area, want, 1e-3), `${flat.area} vs ${want}`);
  check('holes unfold (flange hole lands past base + BA)', flat.holes.length === 2 && near(flat.holes[1].x, 50 + ba + 12), JSON.stringify(flat.holes[1]));
  check('bend lines reported at BA/2', flat.bendLines.length === 2 && near(flat.bendLines[0].a[0], 50 + ba / 2));
  const dxf = sheetFlatDxf(flat);
  const lines = dxf.split('\n');
  const count = (kw) => lines.filter((l, i) => l === kw && lines[i - 1] === '0').length;
  check('DXF R12 header, mm units', /\$ACADVER\n1\nAC1009/.test(dxf) && /\$INSUNITS\n70\n4/.test(dxf));
  check('DXF: one LINE per outline segment, one CIRCLE per hole', count('LINE') === flat.outline[0].length && count('CIRCLE') === 2);
  check('DXF has no bend lines (SCS cuts every line)', !/BEND/.test(dxf));
  check('DXF ends with EOF', dxf.trim().endsWith('EOF'));
  const xs = lines.filter((l, i) => lines[i - 1] === '10' || lines[i - 1] === '11').map(Number);
  check('DXF translated to the origin', near(Math.min(...xs), 0) && near(Math.max(...xs), flat.size[0]));
}

console.log('SCS S5 — STEP from the real sandbox mesh');
{
  const { exec } = await loadSandbox();
  const res = await exec(`${sheetMetalBlock(tray)}\nreturn part;`);
  const mesh = res.mesh || res.meshData || res;
  const vol = meshVolume(mesh);
  check('mesh volume ≈ sandbox volume', near(vol, res.volume, 1e-3 * res.volume));
  const expect = sheetExpectedVolume(tray, flat);
  check('flat area·t + bend-zone correction ≈ solid volume (<0.5%)', Math.abs(expect - vol) / vol < 0.005, `${expect} vs ${vol}`);
  const pf = meshPlanarFaces(mesh);
  const inner = pf.faces.reduce((s, f) => s + f.loops.length - 1, 0);
  const V = new Set(pf.faces.flatMap((f) => f.loops.flat())).size;
  const edges = new Set();
  for (const f of pf.faces) for (const loop of f.loops) loop.forEach((a, i) => { const b = loop[(i + 1) % loop.length]; edges.add(a < b ? `${a}_${b}` : `${b}_${a}`); });
  // Two through holes → genus 2: V − E + F − inner loops = 2 − 2g.
  check('B-rep Euler–Poincaré holds (genus 2)', V - edges.size + pf.faces.length - inner === -2, `${V}-${edges.size}+${pf.faces.length}-${inner}`);
  check('coplanar triangles merge (faces ≪ triangles)', pf.faces.length < pf.triangles / 2, `${pf.faces.length}/${pf.triangles}`);
  const step = meshToStep(mesh, { name: 'tray', timestamp: '2026-10-07T00:00:00' });
  const t = step.text;
  check('STEP AP214 header + mm units', t.startsWith('ISO-10303-21;') && /AUTOMOTIVE_DESIGN/.test(t) && /SI_UNIT\(\.MILLI\.,\.METRE\.\)/.test(t));
  check('one MANIFOLD_SOLID_BREP / CLOSED_SHELL', (t.match(/MANIFOLD_SOLID_BREP\(/g) || []).length === 1 && (t.match(/CLOSED_SHELL\(/g) || []).length === 1);
  check('ADVANCED_FACE count = merged faces', (t.match(/ADVANCED_FACE\(/g) || []).length === step.faces && step.faces === pf.faces.length);
  check('EDGE_CURVE count = unique edges', (t.match(/EDGE_CURVE\(/g) || []).length === edges.size);
  check('inner bounds for the holes', (t.match(/=FACE_BOUND\(/g) || []).length === inner && inner >= 4);
  check('every EDGE_CURVE used twice (closed shell)', (() => {
    const uses = new Map();
    for (const m of t.matchAll(/ORIENTED_EDGE\('',\*,\*,#(\d+),/g)) uses.set(m[1], (uses.get(m[1]) || 0) + 1);
    return uses.size === edges.size && [...uses.values()].every((n) => n === 2);
  })());
  check('STEP reals always carry a decimal point', !/CARTESIAN_POINT\('',\([^)]*\b\d+(,|\))/.test(t.replace(/\d+\.\d*/g, 'R')));
  check('STEP terminates', t.trim().endsWith('END-ISO-10303-21;'));

  console.log('SCS S5 — export bundle + gating');
  const okBundle = buildSheetExport(tray, { mesh, partName: 'Sheet 1', timestamp: 'x' });
  check('clean tray: not blocked, DXF + STEP files named part-sku', !okBundle.blocked && okBundle.files.dxf.name === 'Sheet-1-ALU-090-flat.dxf' && okBundle.files.step.name === 'Sheet-1-ALU-090.step');
  check('fresh mesh is not stale', !okBundle.meshStale);
  check('STEP is built from the spec (exact bends)', okBundle.stepSource === 'spec' && /CYLINDRICAL_SURFACE/.test(okBundle.files.step.text));
  const staleMesh = buildSheetExport({ ...tray, width: 140 }, { mesh });
  check('a stale mesh no longer warns: STEP comes from the spec', !staleMesh.meshStale && staleMesh.stepSource === 'spec' && !staleMesh.dfm.issues.some((i) => i.rule === 'mesh-stale'));
  const fallback = buildSheetExport({ ...tray, width: 140 }, { mesh, exactStep: false });
  check('mesh fallback: faceted warn + mesh-stale only on that path', fallback.stepSource === 'mesh' && fallback.meshStale
    && fallback.dfm.issues.some((i) => i.rule === 'step-faceted') && fallback.dfm.issues.some((i) => i.rule === 'mesh-stale' && i.level === 'warn'));
  const bad = buildSheetExport({ ...tray, holes: [{ id: 'h9', panel: 'base', u: 0, v: 0, d: 0.2 }] }, { mesh });
  check('hard fail blocks export', bad.blocked && bad.dfm.fails >= 1);
  check('no mesh yet → STEP and DXF still built from the spec', !!buildSheetExport(tray).files.step && !!buildSheetExport(tray).files.dxf);
  check('no mesh and no exact STEP → no STEP', buildSheetExport(tray, { exactStep: false }).files.step === null);
  check('file base sanitises names', sheetFileBase('My part / v2', 'ALU-090') === 'My-part-v2-ALU-090');
}

console.log('SCS S5 — mode + UI wiring');
{
  const m = acceptBaseFlange(pickSheetPlane(enterSheetMetalMode(alu, 'p1'), 'XY')).mode;
  const open = openSheetExport(m);
  check('Check opens from edit', open.exportOpen === true);
  check('taps are ignored while export is open', sheetTap(open, { kind: 'edge', panel: 'base', edge: 'u+' }) === open);
  check('tool switch ignored while export is open', setSheetTool(open, 'hole') === open);
  check('close returns to edit', closeSheetExport(open).exportOpen === false);
  const drafting = sheetTap(m, { kind: 'edge', panel: 'base', edge: 'u+' });
  check('cannot open export mid-draft', openSheetExport(drafting) === drafting);
  check('order URL is the SCS app', SCS_ORDER_URL === 'https://app.sendcutsend.com/');
  const flow = read('src/components/sheetMetal/SheetMetalFlow.jsx');
  const handoff = read('src/components/sheetMetal/ScsHandoff.jsx');
  const view = read('src/components/Viewport.jsx');
  const popup = flow.slice(flow.indexOf('const CheckPopup'), flow.indexOf('const TOOL_HINTS'));
  check('chip has Check and Done',
    /data-sm-check="1"/.test(flow)
    && /data-sm-done="1"/.test(flow)
    && /openSheetExport/.test(flow)
    && !/data-sm-export/.test(flow)
    && !/data-sm-undo/.test(flow)
    && !/data-sm-confirm/.test(flow));
  check('export popup has no download or order button',
    !/data-sm-dxf/.test(popup)
    && !/data-sm-order/.test(popup)
    && !/Download DXF/.test(popup)
    && !/Download STEP/.test(popup)
    && !/Order on SendCutSend/.test(popup)
    && /data-sm-dfm-fails/.test(popup)
    && /data-sm-flat-size/.test(popup)
    && /data-sm-step-source/.test(popup));
  check('DXF / STEP / Order live on the handoff and stay disabled while blocked',
    /data-sm-dxf="1"\s*\n\s*disabled=\{blocked/.test(handoff)
    && /data-sm-step="1"\s*\n\s*disabled=\{blocked/.test(handoff)
    && /data-sm-order="1"\s*\n\s*disabled=\{blocked\}/.test(handoff));
  check('Order opens SCS in a new tab without opener', /window\.open\(SCS_ORDER_URL, '_blank', 'noopener,noreferrer'\)/.test(handoff) && !/window\.open\(SCS_ORDER_URL/.test(flow));
  check('export DFM uses the display unit', /buildSheetExport\(mode\.spec, \{[^}]*unit/.test(flow) && /formatSheetLength/.test(flow));
  check('fails red, warns amber', /data-sm-dfm-fails/.test(flow) && /bg-red-950/.test(flow) && /data-sm-dfm-warns/.test(flow) && /bg-amber-950/.test(flow));
  check('Viewport passes the built mesh + part name', /mesh=\{cachedMeshData\}/.test(view) && /partName=\{partLabelsRef\.current/.test(view));
  check('architecture.md documents DFM / export', /DFM \+ export \(S5\)/.test(read('docs/architecture.md')));
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll SCS S5 checks passed');
process.exit(0);
