import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewportPickHost, faceCardState, patchToolParams } from './viewportPicks.js';

const TOP = { center: [0, 0, 10], normal: [0, 0, 1], indices: [0, 1] };
const SIDE = { center: [10, 0, 5], normal: [1, 0, 0], indices: [2, 3] };
const BACK = { center: [0, 10, 5], normal: [0, 1, 0], indices: [4] };

function fakeDeps(over = {}) {
  const calls = [];
  const deps = {
    calls,
    modesValue: {},
    pickModeValue: 'face',
    edges: [],
    group: null,
    face: null,
    tools: {},
    modes: () => deps.modesValue,
    opening: () => false,
    editing: () => false,
    hasMesh: () => true,
    toast: () => null,
    selectedEdges: () => deps.edges,
    facePicks: () => deps.group,
    selectedFace: () => deps.face,
    toolState: (tool) => deps.tools[tool] || null,
    commitToolState: (tool, next) => {
      calls.push(['commit', tool]);
      deps.tools[tool] = next;
    },
    resolveFaces: (keys) => ({ groups: keys.map(() => [TOP]) }),
    resolveEdges: (keys) => ({ groups: keys.map((k) => [{ a: 1, b: Number(k.slice(1)) + 1, partId: 'p' }]) }),
    pickMode: () => deps.pickModeValue,
    setPickMode: (kind) => {
      calls.push(['pickMode', kind]);
      deps.pickModeValue = kind;
    },
    writeFaces: (faces, opts) => {
      calls.push(['writeFaces', faces.length, opts.selection]);
      deps.group = faces.length ? faces : null;
    },
    writeEdges: (edges, opts) => {
      calls.push(['writeEdges', edges.length, opts.selection]);
      deps.edges = edges;
    },
    enter: (tool) => calls.push(['enter', tool]),
    accept: (tool) => calls.push(['accept', tool]),
    exit: (tool) => calls.push(['exit', tool]),
    ...over,
  };
  return deps;
}

test('the host answers before the Viewport has rendered', () => {
  const host = createViewportPickHost(() => null);
  assert.equal(host.pickInfo().busy, 'loading');
  assert.deepEqual(host.pickRead().entries, []);
  assert.equal(host.pickWrite({ entries: [] }).error.code, 'internal');
});

test('selection reads follow the Face / Edge pick mode', () => {
  const deps = fakeDeps();
  const host = createViewportPickHost(() => deps);
  assert.deepEqual(host.pickInfo().kind, 'face');
  host.pickEnter({ kind: 'edge' });
  assert.equal(host.pickInfo().kind, 'edge');
  deps.edges = [{ a: 1, b: 2, partId: 'p' }];
  assert.deepEqual(host.pickRead().entries.map((r) => r.id), ['p::1-2']);
});

test('selection face reads wait for the render that shows the group', () => {
  const deps = fakeDeps();
  const host = createViewportPickHost(() => deps);
  host.pickWrite({ entries: [{ entry: TOP }, { entry: SIDE }] });
  assert.deepEqual(deps.calls.at(-1), ['writeFaces', 2, true]);
  assert.equal(host.pickRead().settled, false);
  deps.face = { ...SIDE, group: [TOP, SIDE] };
  const read = host.pickRead();
  assert.equal(read.settled, true);
  assert.equal(read.entries.length, 2);
  deps.group = null;
  deps.face = { ...BACK };
  assert.equal(host.pickRead().entries.length, 1);
});

test('face cards are rebuilt the way taps build them', () => {
  const move = faceCardState('moveFace', { faces: [BACK], distance: 3, flip: true }, [TOP, SIDE]);
  assert.equal(move.faces.length, 2);
  assert.equal(move.distance, 3);
  const draft = faceCardState('addDraft', { neutral: BACK, drafts: [TOP], angle: 2, flip: false }, [TOP, SIDE, BACK]);
  assert.deepEqual(draft.neutral.center, TOP.center);
  assert.deepEqual(draft.drafts.map((f) => f.center), [SIDE.center, BACK.center]);
});

test('writes route to the open card', () => {
  const deps = fakeDeps({ modesValue: { draft: true } });
  deps.tools.addDraft = { neutral: null, drafts: [], angle: 2, flip: false };
  const host = createViewportPickHost(() => deps);
  assert.equal(host.pickInfo().target, 'addDraft');
  const wrote = host.pickWrite({ entries: [{ entry: TOP }, { entry: SIDE }] });
  assert.equal(wrote.count, 2);
  assert.equal(host.pickRead().entries.length, 2);
  deps.modesValue = { fillet: { entry: 'filletEdges' } };
  host.pickWrite({ entries: [{ entry: { a: 1, b: 2 } }] });
  assert.deepEqual(deps.calls.at(-1), ['writeEdges', 1, false]);
});

test('params patch the card state with the touched flags the card sets', () => {
  const fillet = patchToolParams('filletEdges', { params: { radius: 2, body: 'part' } }, { radius: 1 });
  assert.deepEqual(fillet.params, { radius: 1, body: 'part' });
  assert.equal(fillet.radiusTouched, true);
  assert.equal(patchToolParams('chamferEdges', { params: {} }, { chamfer: 1 }).sizeTouched, true);
  assert.equal(patchToolParams('moveFace', { distance: 1 }, { distance: 4 }).distance, 4);
  assert.equal(patchToolParams('shell', { params: { wall: 1 } }, { wall: 3 }).params.wall, 3);
});

test('resolve turns host groups into rows with tap ids', () => {
  const deps = fakeDeps();
  const host = createViewportPickHost(() => deps);
  const faces = host.pickResolve({ kind: 'face', keys: [{}, {}] });
  assert.equal(faces.groups.length, 2);
  assert.equal(faces.groups[0][0].id, '0,0,10|0,0,1');
  const edges = host.pickResolve({ kind: 'edge', keys: ['e1'] });
  assert.equal(edges.groups[0][0].id, 'p::1-2');
  deps.hasMesh = () => false;
  assert.equal(host.pickResolve({ kind: 'face', keys: [{}] }).error.code, 'no_mesh');
});

test('accept and exit refuse without a card', () => {
  const deps = fakeDeps();
  const host = createViewportPickHost(() => deps);
  assert.equal(host.pickAccept().error.code, 'no_card');
  assert.equal(host.pickExit().ok, false);
  deps.modesValue = { shell: true };
  host.pickAccept();
  host.pickExit();
  assert.deepEqual(deps.calls.slice(-2), [['accept', 'shell'], ['exit', 'shell']]);
});
