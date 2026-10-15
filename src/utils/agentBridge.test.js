import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_STORAGE_KEY,
  agentBridgeEnabled,
  agentFeatureCount,
  cloneAgentBbox,
  commitAgentStep,
  createSurfcadBridge,
} from './agentBridge.js';
import { emptyPartHistory, undoPartHistory } from './partHistory.js';

const BOX = `// --- cube begin ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
return part;
`;

const HOLE = `// --- cube begin ---
let part = Manifold.cube([40, 30, 20], true);
// --- cube end ---
// --- hole begin ---
part = part.subtract(Manifold.cylinder(40, 6, 6, 48, true));
// --- hole end ---
return part;
`;

function storage(value) {
  return {
    getItem(key) {
      return key === AGENT_STORAGE_KEY ? value : null;
    },
  };
}

function world(opts = {}) {
  let buffer = '';
  let history = emptyPartHistory();
  const calls = { execute: 0, setEditor: 0, writeHistory: 0 };
  const host = {
    getScript: () => buffer,
    setEditor(src) {
      buffer = src;
      calls.setEditor += 1;
    },
    readHistory: () => history,
    writeHistory(next) {
      history = { commits: next.commits.slice(), head: next.head };
      calls.writeHistory += 1;
    },
    async execute(src) {
      calls.execute += 1;
      if (opts.wipeOnExecute) {
        history = {
          commits: [
            { code: '', message: 'Part', timestamp: 0, id: 'seed:0' },
            { code: src, message: 'Cube', timestamp: 0, id: 'seed:1' },
          ],
          head: 1,
        };
      }
      if (src.includes('throw')) {
        return {
          ok: false,
          errors: ['agent bridge demo'],
          volume: null,
          bbox: null,
          partName: 'Part (1)',
        };
      }
      const hole = src.includes('subtract');
      return {
        ok: true,
        errors: [],
        volume: hole ? 21738 : 24000,
        bbox: { min: [-20, -15, -10], max: [20, 15, 10] },
        partName: 'Part (1)',
      };
    },
    screenshot: () => 'data:image/png;base64,iVBORw0KGgo=',
  };
  return {
    host,
    calls,
    history: () => history,
    buffer: () => buffer,
    setBuffer(src) { buffer = src; },
  };
}

test('the bridge is on in dev and opt-in elsewhere', () => {
  assert.equal(agentBridgeEnabled({ dev: true, location: { search: '' }, localStorage: storage(null) }), true);
  assert.equal(agentBridgeEnabled({ dev: false, location: { search: '' }, localStorage: storage(null) }), false);
  assert.equal(agentBridgeEnabled({ dev: false, location: { search: '?agent=1' }, localStorage: storage(null) }), true);
  assert.equal(agentBridgeEnabled({ dev: false, location: { search: '?agent=0' }, localStorage: storage(null) }), false);
  assert.equal(agentBridgeEnabled({ dev: false, location: { search: '?foo=1' }, localStorage: storage('1') }), true);
  assert.equal(agentBridgeEnabled({ dev: false, location: { search: '' }, localStorage: storage('0') }), false);
  assert.equal(agentBridgeEnabled({
    dev: false,
    location: { search: '' },
    localStorage: { getItem() { throw new Error('blocked'); } },
  }), false);
  assert.equal(agentBridgeEnabled({
    dev: false,
    location: null,
    localStorage: storage(null),
  }), false);
});

test('status bbox and feature count are plain data', () => {
  assert.equal(cloneAgentBbox(null), null);
  assert.equal(cloneAgentBbox({ min: [1, 2], max: [3, 4, 5] }), null);
  assert.deepEqual(cloneAgentBbox({ min: [1, 2, 3], max: [4, 5, 6] }), {
    min: [1, 2, 3],
    max: [4, 5, 6],
  });
  assert.equal(agentFeatureCount(BOX), 1);
  assert.equal(agentFeatureCount(HOLE), 2);
  assert.equal(agentFeatureCount(''), 0);
});

test('each setScript is exactly one undo step', async () => {
  const env = world();
  const api = createSurfcadBridge(env.host);
  const box = await api.setScript(BOX);
  assert.equal(box.ok, true);
  assert.deepEqual(box.errors, []);
  assert.equal(box.status.volume, 24000);
  assert.equal(box.status.partName, 'Part (1)');
  assert.equal(box.status.featureCount, 1);
  assert.deepEqual(box.status.bbox.min, [-20, -15, -10]);
  assert.equal(env.history().head, 0);
  assert.equal(env.history().commits.length, 1);
  assert.equal(env.calls.execute, 1);
  assert.equal(env.calls.writeHistory, 1);
  assert.equal(env.buffer(), BOX);

  const hole = await api.setScript(HOLE);
  assert.equal(hole.ok, true);
  assert.equal(hole.status.featureCount, 2);
  assert.equal(hole.status.volume, 21738);
  assert.equal(env.history().head, 1);
  assert.equal(env.history().commits.length, 2);
  assert.equal(env.calls.writeHistory, 2);

  const undone = undoPartHistory(env.history());
  assert.equal(undone.code, BOX);
  assert.equal(undone.history.head, 0);
});

test('run of the script setScript just wrote is not a second undo step', async () => {
  const env = world();
  const api = createSurfcadBridge(env.host);
  await api.setScript(BOX);
  const head = env.history().head;
  const ran = await api.run();
  assert.equal(ran.ok, true);
  assert.equal(ran.status.volume, 24000);
  assert.equal(env.history().head, head);
  assert.equal(env.history().commits.length, 1);
  assert.equal(env.calls.execute, 2);
});

test('run of a dirty editor buffer is exactly one undo step', async () => {
  const env = world();
  const api = createSurfcadBridge(env.host);
  await api.setScript(BOX);
  env.setBuffer(HOLE);
  const ran = await api.run();
  assert.equal(ran.ok, true);
  assert.equal(ran.status.featureCount, 2);
  assert.equal(env.history().head, 1);
  assert.equal(env.history().commits.length, 2);
  assert.equal(env.history().commits[1].code, HOLE);
  assert.equal(env.buffer(), HOLE);

  const same = await api.run();
  assert.equal(same.ok, true);
  assert.equal(env.history().head, 1);
});

test('a seed wipe during the run does not turn one call into many undo steps', async () => {
  const env = world({ wipeOnExecute: true });
  const api = createSurfcadBridge(env.host);
  await api.setScript(BOX);
  assert.equal(env.history().commits.length, 1);
  assert.equal(env.history().head, 0);
  assert.equal(env.history().commits[0].code, BOX);

  await api.setScript(HOLE);
  assert.equal(env.history().commits.length, 2);
  assert.equal(env.history().head, 1);
  assert.equal(env.history().commits[0].code, BOX);
  assert.equal(env.history().commits[1].code, HOLE);
  assert.equal(undoPartHistory(env.history()).code, BOX);
});

test('queued setScript calls stay one undo each and finish in order', async () => {
  const env = world();
  const api = createSurfcadBridge(env.host);
  const first = api.setScript(BOX);
  const second = api.setScript(HOLE);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status.featureCount, 1);
  assert.equal(b.status.featureCount, 2);
  assert.equal(env.buffer(), HOLE);
  assert.equal(env.history().head, 1);
  assert.equal(env.history().commits[0].code, BOX);
  assert.equal(env.history().commits[1].code, HOLE);
});

test('errors, status, screenshot, and undo follow the last run', async () => {
  const env = world();
  const api = createSurfcadBridge(env.host);
  assert.deepEqual(api.errors(), []);
  assert.equal(api.status().volume, null);
  assert.equal(api.getScript(), '');

  await api.setScript(BOX);
  await api.setScript(HOLE);
  assert.equal(api.status().featureCount, 2);
  const shot = await api.screenshot();
  assert.equal(shot.startsWith('data:image/png'), true);

  const back = await api.undo();
  assert.equal(back.ok, true);
  assert.equal(back.status.featureCount, 1);
  assert.equal(back.status.volume, 24000);
  assert.equal(api.getScript(), BOX);
  assert.equal(env.history().head, 0);
  assert.deepEqual(api.errors(), []);

  const bad = await api.setScript(`${BOX}\nthrow new Error('agent bridge demo');\n`);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors, ['agent bridge demo']);
  assert.equal(bad.status.volume, null);
  assert.equal(bad.status.partName, 'Part (1)');
  assert.deepEqual(api.errors(), ['agent bridge demo']);
  assert.equal(api.status().volume, null);

  const stuck = await api.undo();
  assert.equal(stuck.ok, true);
  const nothing = await api.undo();
  assert.equal(nothing.ok, false);
  assert.deepEqual(nothing.errors, ['Nothing to undo']);

  const refused = await api.setScript(1);
  assert.equal(refused.ok, false);
  assert.equal(refused.errors[0], 'setScript expects a string');
  assert.equal(env.history().head, 0);
});

test('commitAgentStep does not add a step for the same text', () => {
  const once = commitAgentStep(emptyPartHistory(), BOX, 'Agent script');
  const twice = commitAgentStep(once, BOX, 'Agent run');
  assert.equal(once.head, 0);
  assert.equal(twice.head, 0);
  assert.equal(twice.commits.length, 1);
  const next = commitAgentStep(twice, HOLE, 'Agent script');
  assert.equal(next.head, 1);
  assert.equal(next.commits.length, 2);
});
