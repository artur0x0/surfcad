import test from 'node:test';
import assert from 'node:assert/strict';
import { createPickSessions } from '../pick/session.js';
import { createViewportPickHost } from '../pick/viewportPicks.js';
import { v1Registry } from './index.js';

const FACES = {
  top: { center: [0, 0, 10], normal: [0, 0, 1], indices: [0, 1] },
  side: { center: [10, 0, 5], normal: [1, 0, 0], indices: [2, 3] },
  front: { center: [0, -10, 5], normal: [0, -1, 0], indices: [4, 5] },
};
const KEYS = {
  top: { at: [0, 0, 10], n: [0, 0, 1], area: 400 },
  side: { at: [10, 0, 5], n: [1, 0, 0], area: 200 },
  front: { at: [0, -10, 5], n: [0, -1, 0], area: 200 },
  twin: { at: [5, 5, 5], n: [0, 0, 1], area: 50 },
};

const later = (fn) => setTimeout(fn, 0);
const tick = () => new Promise((resolve) => later(resolve));

/**
 * A viewport whose shown picks lag one tick behind writes, like React
 * state. Accept on a card writes the script the way the card does.
 */
function fakeApp() {
  const vp = {
    modes: {},
    pickMode: 'face',
    edges: [],
    shownEdges: [],
    group: null,
    shownFace: null,
    tools: {},
    toast: null,
    script: 'const part = cube(20);',
    history: { commits: ['const part = cube(20);'], head: 0 },
    runs: 0,
    dismissed: 0,
    editing: false,
  };
  const render = () => later(() => {
    vp.shownEdges = vp.edges;
    const g = vp.group;
    vp.shownFace = g && g.length ? { ...g[g.length - 1], ...(g.length > 1 ? { group: g } : {}) } : null;
  });
  const deps = {
    modes: () => vp.modes,
    opening: () => false,
    editing: () => vp.editing,
    hasMesh: () => true,
    toast: () => vp.toast,
    selectedEdges: () => vp.shownEdges,
    facePicks: () => vp.group,
    selectedFace: () => vp.shownFace,
    toolState: (tool) => vp.tools[tool] || null,
    commitToolState: (tool, next) => {
      vp.tools[tool] = next;
      render();
    },
    resolveFaces: (keys) => {
      const groups = [];
      for (let i = 0; i < keys.length; i++) {
        const name = Object.keys(KEYS).find((k) => KEYS[k].at.join() === keys[i].at.join());
        if (name === 'twin') {
          return { error: { code: 'ambiguous_face', message: 'two', details: { index: i, candidates: [{ ...KEYS.twin, src: -2, ord: 0 }] } } };
        }
        if (!name) return { error: { code: 'unknown_face', message: 'none', details: { index: i } } };
        groups.push([FACES[name]]);
      }
      return { groups };
    },
    resolveEdges: (keys) => {
      const groups = [];
      for (let i = 0; i < keys.length; i++) {
        const m = /^e(\d+)$/.exec(keys[i]);
        if (!m || m[1] === '404') return { error: { code: 'unknown_edge', message: 'none', details: { index: i } } };
        const n = Number(m[1]);
        // e9 is a two-segment tangent chain.
        groups.push(n === 9
          ? [{ a: 90, b: 91, partId: 'p' }, { a: 91, b: 92, partId: 'p' }]
          : [{ a: n, b: n + 100, partId: 'p' }]);
      }
      return { groups };
    },
    pickMode: () => vp.pickMode,
    setPickMode: (kind) => { vp.pickMode = kind; },
    writeFaces: (faces) => {
      vp.group = faces.length ? faces.slice() : null;
      render();
    },
    writeEdges: (edges) => {
      vp.edges = edges.slice();
      render();
    },
    enter: (tool) => {
      vp.toast = null;
      if (tool === 'filletEdges' || tool === 'chamferEdges') {
        vp.modes = { fillet: { entry: tool } };
        vp.tools[tool] = { entry: tool, params: { radius: 2 } };
      } else if (tool === 'deleteFace') {
        vp.modes = { deleteFace: true };
        vp.tools.deleteFace = { faces: (vp.group || []).slice() };
      } else {
        vp.modes = { [tool === 'addDraft' ? 'draft' : tool]: true };
        vp.tools[tool] = { faces: [] };
      }
    },
    accept: (tool) => {
      const state = vp.tools[tool];
      if (tool === 'filletEdges') {
        if (!vp.shownEdges.length) {
          vp.toast = { text: 'Pick at least one edge.' };
          return;
        }
        vp.script += `\nfillet(${vp.shownEdges.length}, ${state.params.radius});`;
        vp.edges = [];
        render();
      } else if (tool === 'deleteFace') {
        if (!state.faces.length) {
          vp.toast = { text: 'Tap a face to delete.' };
          return;
        }
        vp.script += `\ndeleteFace(${state.faces.length});`;
      }
      vp.history = { commits: [...vp.history.commits, vp.script], head: vp.history.head + 1 };
      vp.modes = {};
      vp.tools[tool] = null;
    },
    exit: (tool) => {
      vp.modes = {};
      vp.tools[tool] = null;
      vp.edges = [];
      render();
    },
  };
  const host = createViewportPickHost(() => deps);
  const ctx = {
    ...host,
    pickSessions: createPickSessions(),
    wait: tick,
    getScript: () => vp.script,
    readHistory: () => vp.history,
    writeHistory: (h) => { vp.history = h; },
    cloneHistory: (h) => ({ commits: h.commits.slice(), head: h.head }),
    readStatus: () => ({ featureCount: 0 }),
    async mutate(text, message) {
      vp.script = text;
      vp.history = { commits: [...vp.history.commits, text], head: vp.history.head + 1, message };
      vp.runs += 1;
      return { ok: true, errors: [], status: { featureCount: 1 } };
    },
    dismissFeatureConfirmSession: () => { vp.dismissed += 1; },
  };
  const call = async (name, args = {}) => {
    const command = v1Registry.get(name);
    const refused = command.checkArgs?.(args);
    if (refused) return { error: refused };
    return command.run(ctx, args);
  };
  return { vp, ctx, call };
}

test('pick a face into the selection for use_selection', async () => {
  const { vp, call } = fakeApp();
  vp.group = [FACES.side];
  vp.shownFace = { ...FACES.side };
  const begun = await call('pick_begin', { kind: 'face', max: 1 });
  assert.equal(begun.result.target, 'selection');
  assert.equal(begun.result.count, 0, 'selection starts empty by default');
  assert.equal(vp.group, null);
  const next = await call('pick_next', { key: KEYS.top });
  assert.equal(next.result.count, 1);
  assert.deepEqual(vp.shownFace.center, FACES.top.center);
  const over = await call('pick_next', { key: KEYS.side });
  assert.equal(over.error.code, 'pick_limit');
  assert.equal(vp.group.length, 1, 'a refused pick does not change the viewport');
  const done = await call('pick_done');
  assert.equal(done.result.done, true);
  assert.equal(done.result.accepted, false);
  assert.deepEqual(vp.shownFace.center, FACES.top.center, 'picks stay for the helper');
  assert.equal((await call('pick_next', { key: KEYS.top })).error.code, 'no_pick_session');
});

test('edge picks: chains count as one pick, repeats are skipped, remove taps off', async () => {
  const { vp, call } = fakeApp();
  await call('pick_begin', { kind: 'edge' });
  assert.equal(vp.pickMode, 'edge');
  const next = await call('pick_next', { keys: ['e9', 'e3', 'e3'] });
  assert.equal(next.result.count, 2);
  assert.equal(next.result.skipped, 1);
  assert.equal(next.result.entries, 3);
  assert.equal(vp.shownEdges.length, 3);
  const off = await call('pick_next', { key: 'e9', remove: true });
  assert.equal(off.result.count, 1);
  assert.equal(vp.shownEdges.length, 1);
  assert.equal((await call('pick_next', { key: 'e9', remove: true })).error.code, 'not_picked');
  const undo = await call('pick_undo');
  assert.equal(undo.result.count, 0);
  assert.equal((await call('pick_undo')).error.code, 'nothing_to_undo');
  const empty = await call('pick_done');
  assert.equal(empty.error.code, 'empty_pick');
  assert.ok(await call('pick_cancel'));
});

test('structured errors: open session, bad key, ambiguous face, wrong kind', async () => {
  const { call } = fakeApp();
  assert.equal((await call('pick_begin', {})).error.code, 'bad_args');
  assert.equal((await call('pick_begin', { kind: 'point' })).error.code, 'bad_args');
  assert.equal((await call('pick_begin', { tool: 'filletEdges', kind: 'face' })).error.code, 'wrong_kind');
  await call('pick_begin', { kind: 'face' });
  const again = await call('pick_begin', { kind: 'edge' });
  assert.equal(again.error.code, 'pick_open');
  assert.equal(again.error.details.target, 'selection');
  assert.equal((await call('pick_next', { key: 'e3' })).error.code, 'bad_args');
  const amb = await call('pick_next', { key: KEYS.twin });
  assert.equal(amb.error.code, 'ambiguous_face');
  assert.equal(amb.error.details.candidates[0].src, -2);
  assert.equal((await call('pick_next', { key: { at: [9, 9, 9], n: [0, 0, 1], area: 1 } })).error.code, 'unknown_face');
  const swapped = await call('pick_begin', { kind: 'edge', replace: true });
  assert.equal(swapped.result.kind, 'edge');
});

test('the selection kind changing ends the session with pick_closed', async () => {
  const { vp, call } = fakeApp();
  await call('pick_begin', { kind: 'face' });
  vp.pickMode = 'edge';
  const out = await call('pick_next', { key: KEYS.top });
  assert.equal(out.error.code, 'pick_closed');
  assert.equal((await call('pick_state')).result.session, null);
});

test('pick_edges opens Fillet, sets the radius, and Accept is one undo step', async () => {
  const { vp, call } = fakeApp();
  const out = await call('pick_edges', { tool: 'filletEdges', keys: ['e3', 'e5'], params: { radius: 1 }, accept: true });
  assert.equal(out.error, undefined, JSON.stringify(out.error));
  assert.equal(out.result.accepted, true);
  assert.equal(out.result.unchanged, false);
  assert.match(vp.script, /fillet\(2, 1\);$/);
  assert.equal(vp.history.commits.length, 2, 'card step replaced by one agent step');
  assert.equal(vp.history.message, 'Agent pick: filletEdges');
  assert.equal(vp.runs, 1);
  assert.deepEqual(vp.modes, {});
});

test('a card that refuses Accept stays open and reports its toast', async () => {
  const { vp, call } = fakeApp();
  await call('pick_begin', { tool: 'filletEdges', min: 0 });
  const out = await call('pick_done', { accept: true });
  assert.equal(out.error.code, 'accept_refused');
  assert.equal(out.error.message, 'Pick at least one edge.');
  assert.ok(vp.modes.fillet);
  const state = await call('pick_state');
  assert.equal(state.result.session.target, 'filletEdges');
  const cancelled = await call('pick_cancel');
  assert.equal(cancelled.result.closed, true, 'a card the session opened is dismissed');
  assert.deepEqual(vp.modes, {});
});

test('an open card keeps its preselection and tool must match it', async () => {
  const { vp, call } = fakeApp();
  vp.group = [FACES.side];
  vp.shownFace = { ...FACES.side };
  await call('pick_begin', { tool: 'deleteFace' });
  await call('pick_cancel');
  vp.modes = { deleteFace: true };
  vp.tools.deleteFace = { faces: [FACES.side] };
  assert.equal((await call('pick_begin', { tool: 'shell' })).error.code, 'picker_busy');
  const begun = await call('pick_begin', {});
  assert.equal(begun.result.target, 'deleteFace');
  assert.equal(begun.result.seeded, 1);
  assert.equal(begun.result.opened, false);
  await call('pick_next', { key: KEYS.top });
  assert.equal(vp.tools.deleteFace.faces.length, 2);
  const restored = await call('pick_cancel');
  assert.equal(restored.result.restored, true);
  assert.equal(vp.tools.deleteFace.faces.length, 1, 'cancel puts the card back');
});

test('accept on an edit card closes the agent feature session', async () => {
  const { vp, call } = fakeApp();
  vp.modes = { deleteFace: true };
  vp.tools.deleteFace = { faces: [FACES.side] };
  vp.editing = true;
  const out = await call('pick_faces', { keys: [KEYS.front], accept: true });
  assert.equal(out.result.accepted, true);
  assert.equal(out.result.editing, true);
  assert.equal(vp.dismissed, 1);
  assert.match(vp.script, /deleteFace\(2\);$/);
});

test('busy modes refuse with the owner', async () => {
  const { vp, call } = fakeApp();
  vp.modes = { featureSlot: true };
  const out = await call('pick_faces', { keys: [KEYS.top] });
  assert.equal(out.error.code, 'picker_busy');
  assert.equal(out.error.details.viewport, 'featureSlot');
});

test('one-shot failures leave no session behind', async () => {
  const { vp, call } = fakeApp();
  vp.group = [FACES.side];
  vp.shownFace = { ...FACES.side };
  const out = await call('pick_faces', { keys: [KEYS.twin] });
  assert.equal(out.error.code, 'ambiguous_face');
  assert.equal((await call('pick_state')).result.session, null);
  assert.deepEqual(vp.group, [FACES.side], 'the earlier selection is restored');
  const wrongTool = await call('pick_faces', { tool: 'filletEdges', keys: [KEYS.top] });
  assert.equal(wrongTool.error.code, 'bad_args');
});
