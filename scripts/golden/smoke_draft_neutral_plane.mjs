#!/usr/bin/env node
/**
 * Neutral-plane draft (SolidWorks Neutral Plane / Fusion Fixed Plane /
 * Onshape neutral plane). Not a parting-line taper.
 *
 * Manifold.cube([40, 30, 20], true). Extents x ±20, y ±15, z ±10.
 * Angle +5°. h = 20 * tan(5°), computed — not a rounded constant.
 *
 *   1. Neutral +Z, draft +X. Top edge of +X stays at x=20. Bottom edge moves
 *      out to x=20+h. −X stays at x=−20. +Z unchanged. −Z grows on +X.
 *      +Y and −Y stay at y=±15.
 *   2. Same neutral. Draft +X and +Y. Top corner (20, 15, 10) stays. Bottom
 *      corner is one vertex (20+h, 15+h, −10). −X and −Y stay put.
 *   3. Neutral −Z (pull −Z). Draft +X and −X. Bottom edges stay at x=±20.
 *      Top edges move out to x=20+h and x=−20−h. Y faces not drafted.
 *      Top face grows in X. Bottom face unchanged.
 *
 * A single face parallel to the pull throws (a cap is not skipped).
 * Confirm emits exactly one draftFaces() with pull from the neutral face and
 * reference the neutral pick. No addDraft. Flip reverses the pull. Undo drops
 * only the last drafted face. Clear keeps the neutral. Tapping the neutral
 * again replaces it and does not draft it.
 */
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const H = 20 * Math.tan((5 * Math.PI) / 180);
console.log(`neutral-plane draft  h=${H}`);

const {
  emptyDraftState,
  applyDraftFaceTap,
  popLastDraftFace,
  clearDraftFaces,
  setDraftFlip,
  composeDraftCommit,
  validateDraftAccept,
  draftPullOf,
} = await import('../../src/utils/draftMode.js');

const Zp = { center: [0, 0, 10], normal: [0, 0, 1] };
const Zm = { center: [0, 0, -10], normal: [0, 0, -1] };
const Xp = { center: [20, 0, 0], normal: [1, 0, 0] };
const _Xm = { center: [-20, 0, 0], normal: [-1, 0, 0] };
const Yp = { center: [0, 15, 0], normal: [0, 1, 0] };

{
  let s = emptyDraftState();
  s = applyDraftFaceTap(s, Zp);
  check('first tap is the neutral face', s.neutral && s.drafts.length === 0 && !s.replaceNeutral);
  s = applyDraftFaceTap(s, Xp);
  s = applyDraftFaceTap(s, Yp);
  check('later taps are the faces to draft', s.drafts.length === 2
    && s.drafts[0].normal[0] === 1 && s.drafts[1].normal[1] === 1);
  const undone = popLastDraftFace(s);
  check('Undo drops only the last drafted face',
    undone.drafts.length === 1 && undone.drafts[0].normal[0] === 1
    && undone.neutral.normal[2] === 1);
  const cleared = clearDraftFaces(s);
  check('Clear keeps the neutral face',
    cleared.drafts.length === 0 && cleared.neutral.normal[2] === 1);

  let repl = applyDraftFaceTap(applyDraftFaceTap(emptyDraftState(), Zp), Xp);
  repl = applyDraftFaceTap(repl, Zp);
  check('tapping the neutral face again does not draft it',
    repl.replaceNeutral === true
    && repl.drafts.length === 1
    && repl.drafts.every((f) => f.normal[2] !== 1)
    && repl.neutral.normal[2] === 1);
  repl = applyDraftFaceTap(repl, Zm);
  check('the next tap replaces the neutral face',
    repl.neutral.normal[2] === -1
    && repl.replaceNeutral === false
    && repl.drafts.length === 1
    && repl.drafts[0].normal[0] === 1);

  let emit = applyDraftFaceTap(applyDraftFaceTap(emptyDraftState(), Zp), Xp);
  emit = { ...emit, angle: 5 };
  const once = composeDraftCommit('let part = Manifold.cube([40, 30, 20], true);', emit);
  check('confirm emits exactly one draftFaces',
    once.ok && (once.buffer.match(/draftFaces\s*\(/g) || []).length === 1, once.buffer || once.message);
  check('pull comes from the neutral face and reference is the neutral pick',
    /pull: \[0, 0, 1\], reference: \{ center: \[0, 0, 10\], normal: \[0, 0, 1\] \}/.test(once.buffer || ''));
  check('confirm does not emit addDraft or a world-axis pull',
    once.ok && !/addDraft\s*\(/.test(once.buffer) && !/pull:\s*'/.test(once.buffer));
  const flipped = setDraftFlip(emit, true);
  const flipOut = composeDraftCommit('', flipped);
  check('Flip reverses the pull normal',
    flipOut.ok && /pull: \[0, 0, -1\]/.test(flipOut.buffer)
    && draftPullOf(flipped)[2] === -1,
    flipOut.buffer || flipOut.message);
  const again = composeDraftCommit(once.buffer, { ...emit, angle: 2 });
  check('a later Draft replaces the previous block',
    again.ok && (again.buffer.match(/--- draft begin( id=\w+)? ---/g) || []).length === 1
    && (again.buffer.match(/draftFaces\s*\(/g) || []).length === 1);

  const cap = applyDraftFaceTap(applyDraftFaceTap(emptyDraftState(), Zp), Zm);
  const refused = validateDraftAccept({ ...cap, angle: 5 });
  check('a face parallel to the pull is refused, not dropped',
    !refused.ok && /parallel/.test(refused.message || ''));
  const neutralInList = validateDraftAccept({
    ...emptyDraftState(),
    neutral: Zp,
    drafts: [Zp, Xp],
    angle: 5,
  });
  check('neutral face in the draft list is refused',
    !neutralInList.ok && /neutral face is in the draft list/.test(neutralInList.message || ''));
}

{
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const view = read('../../src/components/Viewport.jsx');
  const chip = read('../../src/components/DraftModeChip.jsx');
  const palette = read('../../src/components/HelperInsertPalette.jsx');
  const app = read('../../src/App.jsx');
  check('palette routes Draft into draft mode',
    /item\.id === 'addDraft'/.test(palette) && /onEnterDraftMode\(\{\s*entry:\s*'addDraft'\s*\}\)/.test(palette));
  check('missed tap does not clear the draft set', /Preserve draft face selection/.test(view));
  check('Viewport confirm is acceptDraft', /onConfirm=\{acceptDraft\}/.test(view) && /onCommitDraft/.test(view));
  check('App writes composeDraftCommit', /composeDraftCommit/.test(app) && /onCommitDraft=\{handleCommitDraft\}/.test(app));
  check('draft uses the shared feature card',
    /<FeatureSheet\b/.test(chip)
    && /onCancel=\{onDismiss\}/.test(chip)
    && /onConfirm=\{onConfirm\}/.test(chip)
    && /draftMode && mode !== 'game'/.test(view));
  check('chip has Flip, Undo, Clear',
    /data-draft-flip/.test(chip) && /data-draft-undo/.test(chip) && /data-draft-clear/.test(chip));
  check('chip default angle is signed', /min=\{-45\}/.test(chip) && /id="draft-angle"/.test(chip));
  check('chip does not ask for shift-click', !/shift-click/.test(chip) && !/shiftKey/.test(chip));
  check('ui-style-guide documents DraftModeChip', /DraftModeChip/.test(read('../../docs/ui-style-guide.md')));
}

const pending = new Map();
let msgId = 0;
const workerSelf = {
  onmessage: null,
  postMessage(msg) {
    if (msg.type === 'loaded') return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.type === 'error') waiter.reject(new Error(msg.payload?.message || 'worker error'));
    else waiter.resolve(msg);
  },
};
globalThis.self = workerSelf;

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    Promise.resolve().then(() => {
      if (!workerSelf.onmessage) {
        reject(new Error('sandboxWorker handler missing'));
        return;
      }
      workerSelf.onmessage({ data: { type, payload, id } });
    });
  });
}

register('./manifold-resolve-hook.mjs', import.meta.url);
await import('../../src/workers/sandboxWorker.js');
await send('init');

async function exec(script) {
  const res = await send('execute', { script, importedModels: {}, memoryLimitMB: 512 });
  return res.payload;
}
async function execFail(script) {
  try {
    await exec(script);
    return null;
  } catch (e) {
    return e.message || String(e);
  }
}

function verts(mesh) {
  const np = mesh.numProp || 3;
  const out = [];
  for (let i = 0; i < mesh.vertProperties.length; i += np) {
    out.push([mesh.vertProperties[i], mesh.vertProperties[i + 1], mesh.vertProperties[i + 2]]);
  }
  return out;
}
function hasVertex(vs, x, y, z, tol = 1e-2) {
  return vs.some((v) => Math.abs(v[0] - x) <= tol && Math.abs(v[1] - y) <= tol && Math.abs(v[2] - z) <= tol);
}
function countNear(vs, x, y, z, tol = 1e-2) {
  const seen = new Set();
  for (const v of vs) {
    if (Math.abs(v[0] - x) <= tol && Math.abs(v[1] - y) <= tol && Math.abs(v[2] - z) <= tol) {
      seen.add(v.map((n) => Math.round(n * 1e4) / 1e4).join(','));
    }
  }
  return seen.size;
}

const cube = 'let part = Manifold.cube([40, 30, 20], true);';

{
  const res = await exec(`
    ${cube}
    part = draftFaces(part, [
      { center: [20, 0, 0], normal: [1, 0, 0] },
    ], 5, { pull: [0, 0, 1], reference: { center: [0, 0, 10], normal: [0, 0, 1] } });
    return part;
  `);
  const vs = verts(res.mesh);
  check('1 top edge of +X stays at x=20',
    hasVertex(vs, 20, 15, 10) && hasVertex(vs, 20, -15, 10));
  check('1 bottom edge of +X moves out to x=20+h',
    hasVertex(vs, 20 + H, 15, -10) && hasVertex(vs, 20 + H, -15, -10),
    `h=${H}`);
  check('1 −X stays at x=−20',
    hasVertex(vs, -20, 15, 10) && hasVertex(vs, -20, -15, -10)
    && vs.every((v) => v[0] >= -20 - 1e-2));
  check('1 +Z unchanged (no top vertex past x=20)',
    vs.filter((v) => v[2] > 9).every((v) => Math.abs(v[2] - 10) <= 1e-2 && v[0] <= 20 + 1e-2 && v[0] >= -20 - 1e-2));
  check('1 −Z grows on the +X side',
    vs.some((v) => v[2] < -9 && v[0] > 20 + H - 1e-2));
  check('1 +Y and −Y stay at y=±15',
    hasVertex(vs, -20, 15, 10) && hasVertex(vs, -20, -15, 10)
    && vs.every((v) => Math.abs(v[1]) <= 15 + 1e-2));
}

{
  const res = await exec(`
    ${cube}
    part = draftFaces(part, [
      { center: [20, 0, 0], normal: [1, 0, 0] },
      { center: [0, 15, 0], normal: [0, 1, 0] },
    ], 5, { pull: [0, 0, 1], reference: { center: [0, 0, 10], normal: [0, 0, 1] } });
    return part;
  `);
  const vs = verts(res.mesh);
  check('2 top corner (20, 15, 10) stays', hasVertex(vs, 20, 15, 10));
  check('2 bottom corner is one vertex (20+h, 15+h, −10)',
    countNear(vs, 20 + H, 15 + H, -10) === 1
    && !hasVertex(vs, 20 + H, 15, -10)
    && !hasVertex(vs, 20, 15 + H, -10),
    `h=${H}`);
  check('2 −X and −Y stay put',
    hasVertex(vs, -20, -15, 10) && hasVertex(vs, -20, -15, -10)
    && vs.every((v) => v[0] >= -20 - 1e-2)
    && vs.every((v) => v[1] >= -15 - 1e-2));
}

{
  const res = await exec(`
    ${cube}
    part = draftFaces(part, [
      { center: [20, 0, 0], normal: [1, 0, 0] },
      { center: [-20, 0, 0], normal: [-1, 0, 0] },
    ], 5, { pull: [0, 0, -1], reference: { center: [0, 0, -10], normal: [0, 0, -1] } });
    return part;
  `);
  const vs = verts(res.mesh);
  check('3 bottom edges stay at x=±20',
    hasVertex(vs, 20, 15, -10) && hasVertex(vs, -20, 15, -10)
    && hasVertex(vs, 20, -15, -10) && hasVertex(vs, -20, -15, -10));
  check('3 top edges move out to x=20+h and x=−20−h',
    hasVertex(vs, 20 + H, 15, 10) && hasVertex(vs, 20 + H, -15, 10)
    && hasVertex(vs, -20 - H, 15, 10) && hasVertex(vs, -20 - H, -15, 10),
    `h=${H}`);
  check('3 +Y and −Y not drafted',
    vs.every((v) => Math.abs(v[1]) <= 15 + 1e-2)
    && hasVertex(vs, 20, 15, -10) && hasVertex(vs, 20, -15, -10));
  check('3 top face grows in X',
    vs.filter((v) => v[2] > 9).some((v) => v[0] > 20 + H - 1e-2)
    && vs.filter((v) => v[2] > 9).some((v) => v[0] < -20 - H + 1e-2));
  check('3 bottom face unchanged',
    vs.filter((v) => v[2] < -9).every((v) => Math.abs(v[0]) <= 20 + 1e-2 && Math.abs(v[2] + 10) <= 1e-2));
}

{
  const mixed = await execFail(`
    ${cube}
    part = draftFaces(part, [
      { center: [20, 0, 0], normal: [1, 0, 0] },
      { center: [0, 0, 10], normal: [0, 0, 1] },
    ], 5, { pull: [0, 0, 1], reference: { center: [0, 0, 10], normal: [0, 0, 1] } });
    return part;
  `);
  check('a single parallel face in the list throws',
    !!mixed && /parallel/.test(mixed) && /perpendicular/.test(mixed), mixed || 'no throw');
  const onlyCap = await execFail(`
    ${cube}
    part = draftFaces(part, [
      { center: [0, 0, 10], normal: [0, 0, 1] },
    ], 5, { pull: [0, 0, 1], reference: { center: [0, 0, -10], normal: [0, 0, -1] } });
    return part;
  `);
  check('a lone cap throws instead of being skipped',
    !!onlyCap && /parallel/.test(onlyCap), onlyCap || 'no throw');
}

if (failed) {
  console.log(`\n${failed} neutral-plane draft check(s) failed`);
  process.exit(1);
}
console.log('\nAll neutral-plane draft checks passed.');
