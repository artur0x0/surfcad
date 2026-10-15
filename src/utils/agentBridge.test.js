import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_BRIDGE_VERSION,
  AGENT_COMMANDS,
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

const COMMANDS = [
  'get_script',
  'set_script',
  'run',
  'status',
  'errors',
  'screenshot',
  'undo',
  'list_commands',
  'feature_tree',
  'selection',
  'mode',
  'dirty',
  'toasts',
  'parts',
  'camera',
  'list_faces',
  'list_edges',
  'select_clear',
  'select_faces',
  'select_edges',
  'select_parts',
  'set_active_part',
  'camera_set',
  'camera_fit',
  'zoom_to_selection',
];

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
      const min = opts.typedBbox ? new Float64Array([-20, -15, -10]) : [-20, -15, -10];
      const max = opts.typedBbox ? new Float64Array([20, 15, 10]) : [20, 15, 10];
      return {
        ok: true,
        errors: [],
        volume: hole ? 21738 : 24000,
        bbox: { min, max },
        partName: 'Part (1)',
      };
    },
    screenshot() {
      if (Object.prototype.hasOwnProperty.call(opts, 'screenshot')) return opts.screenshot;
      return 'data:image/png;base64,iVBORw0KGgo=';
    },
  };
  return {
    host,
    calls,
    history: () => history,
    buffer: () => buffer,
    setBuffer(src) { buffer = src; },
  };
}

/** MCP path: args travel as a JSON string. The envelope must round-trip. */
async function invoke(api, name, args) {
  const env = await api.call(name, JSON.stringify(args ?? {}));
  assert.deepEqual(JSON.parse(JSON.stringify(env)), env);
  assert.equal(env.v, 1);
  return env;
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
  const typed = cloneAgentBbox({
    min: new Float64Array([1, 2, 3]),
    max: new Float64Array([4, 5, 6]),
  });
  assert.equal(Array.isArray(typed.min), true);
  assert.equal(Object.prototype.toString.call(typed.min), '[object Array]');
  assert.deepEqual(typed, { min: [1, 2, 3], max: [4, 5, 6] });
  assert.equal(agentFeatureCount(BOX), 1);
  assert.equal(agentFeatureCount(HOLE), 2);
  assert.equal(agentFeatureCount(''), 0);
});

test('version and commands are the v1 tool list', () => {
  const api = createSurfcadBridge(world().host);
  assert.equal(AGENT_BRIDGE_VERSION, 1);
  assert.equal(api.version, 1);
  assert.deepEqual(api.commands, COMMANDS);
  assert.deepEqual(AGENT_COMMANDS, COMMANDS);
  assert.equal(Object.isFrozen(api.commands), true);
});

test('each set_script is exactly one undo step', async () => {
  const env = world();
  const api = createSurfcadBridge(env.host);
  const box = await invoke(api, 'set_script', { source: BOX });
  assert.equal(box.ok, true);
  assert.equal(box.result.ok, true);
  assert.deepEqual(box.result.errors, []);
  assert.equal(box.result.status.volume, 24000);
  assert.equal(box.result.status.partName, 'Part (1)');
  assert.equal(box.result.status.featureCount, 1);
  assert.deepEqual(box.result.status.bbox.min, [-20, -15, -10]);
  assert.equal(Array.isArray(box.result.status.bbox.min), true);
  assert.equal(env.history().head, 0);
  assert.equal(env.history().commits.length, 1);
  assert.equal(env.calls.execute, 1);
  assert.equal(env.calls.writeHistory, 1);
  assert.equal(env.buffer(), BOX);

  const hole = await invoke(api, 'set_script', { source: HOLE, future: true });
  assert.equal(hole.ok, true);
  assert.equal(hole.result.status.featureCount, 2);
  assert.equal(hole.result.status.volume, 21738);
  assert.equal(env.history().head, 1);
  assert.equal(env.history().commits.length, 2);
  assert.equal(env.calls.writeHistory, 2);

  const undone = undoPartHistory(env.history());
  assert.equal(undone.code, BOX);
  assert.equal(undone.history.head, 0);
});

test('run of the script set_script just wrote is not a second undo step', async () => {
  const env = world();
  const api = createSurfcadBridge(env.host);
  await invoke(api, 'set_script', { source: BOX });
  const head = env.history().head;
  const ran = await invoke(api, 'run');
  assert.equal(ran.ok, true);
  assert.equal(ran.result.ok, true);
  assert.equal(ran.result.status.volume, 24000);
  assert.equal(env.history().head, head);
  assert.equal(env.history().commits.length, 1);
  assert.equal(env.calls.execute, 2);
});

test('run of a dirty editor buffer is exactly one undo step', async () => {
  const env = world();
  const api = createSurfcadBridge(env.host);
  await invoke(api, 'set_script', { source: BOX });
  env.setBuffer(HOLE);
  const ran = await invoke(api, 'run');
  assert.equal(ran.ok, true);
  assert.equal(ran.result.status.featureCount, 2);
  assert.equal(env.history().head, 1);
  assert.equal(env.history().commits.length, 2);
  assert.equal(env.history().commits[1].code, HOLE);
  assert.equal(env.buffer(), HOLE);

  const same = await invoke(api, 'run');
  assert.equal(same.ok, true);
  assert.equal(env.history().head, 1);
});

test('a seed wipe during the run does not turn one call into many undo steps', async () => {
  const env = world({ wipeOnExecute: true });
  const api = createSurfcadBridge(env.host);
  await invoke(api, 'set_script', { source: BOX });
  assert.equal(env.history().commits.length, 1);
  assert.equal(env.history().head, 0);
  assert.equal(env.history().commits[0].code, BOX);

  await invoke(api, 'set_script', { source: HOLE });
  assert.equal(env.history().commits.length, 2);
  assert.equal(env.history().head, 1);
  assert.equal(env.history().commits[0].code, BOX);
  assert.equal(env.history().commits[1].code, HOLE);
  assert.equal(undoPartHistory(env.history()).code, BOX);
});

test('queued set_script calls stay one undo each and finish in order', async () => {
  const env = world();
  const api = createSurfcadBridge(env.host);
  const first = invoke(api, 'set_script', { source: BOX });
  const second = invoke(api, 'set_script', { source: HOLE });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.result.status.featureCount, 1);
  assert.equal(b.result.status.featureCount, 2);
  assert.equal(env.buffer(), HOLE);
  assert.equal(env.history().head, 1);
  assert.equal(env.history().commits[0].code, BOX);
  assert.equal(env.history().commits[1].code, HOLE);
});

test('a typed-array bbox leaves the envelope as plain JSON', async () => {
  const env = world({ typedBbox: true });
  const api = createSurfcadBridge(env.host);
  const wrote = await invoke(api, 'set_script', { source: BOX });
  const min = wrote.result.status.bbox.min;
  assert.equal(Array.isArray(min), true);
  assert.equal(Object.prototype.toString.call(min), '[object Array]');
  assert.deepEqual(min, [-20, -15, -10]);
  assert.deepEqual(wrote.result.status.bbox.max, [20, 15, 10]);
});

test('status, errors, screenshot, and undo follow the last run', async () => {
  const env = world();
  const api = createSurfcadBridge(env.host);
  const emptyErrors = await invoke(api, 'errors');
  const emptyStatus = await invoke(api, 'status');
  const emptyScript = await invoke(api, 'get_script');
  assert.deepEqual(emptyErrors.result, { errors: [] });
  assert.equal(emptyErrors.result.errors.length, 0);
  assert.equal(emptyStatus.result.volume, null);
  assert.equal(emptyStatus.result.bbox, null);
  assert.equal(emptyScript.result.source, '');

  await invoke(api, 'set_script', { source: BOX });
  await invoke(api, 'set_script', { source: HOLE });
  const status = await invoke(api, 'status');
  assert.equal(status.result.featureCount, 2);
  const shot = await invoke(api, 'screenshot', { format: 'png' });
  assert.equal(shot.ok, true);
  assert.equal(shot.result.dataUrl.startsWith('data:image/png'), true);
  const omitted = await invoke(api, 'screenshot');
  assert.equal(omitted.result.dataUrl, shot.result.dataUrl);

  const back = await invoke(api, 'undo');
  assert.equal(back.ok, true);
  assert.equal(back.result.ok, true);
  assert.equal(back.result.status.featureCount, 1);
  assert.equal(back.result.status.volume, 24000);
  const script = await invoke(api, 'get_script');
  assert.equal(script.result.source, BOX);
  assert.equal(env.history().head, 0);
  assert.deepEqual((await invoke(api, 'errors')).result.errors, []);

  const bad = await invoke(api, 'set_script', { source: `${BOX}\nthrow new Error('agent bridge demo');\n` });
  assert.equal(bad.ok, true);
  assert.equal(bad.result.ok, false);
  assert.deepEqual(bad.result.errors, ['agent bridge demo']);
  assert.equal(bad.result.status.volume, null);
  assert.equal(bad.result.status.partName, 'Part (1)');
  assert.deepEqual((await invoke(api, 'errors')).result.errors, [
    { code: 'build_failed', message: 'agent bridge demo' },
  ]);
  assert.equal((await invoke(api, 'status')).result.volume, null);

  const stuck = await invoke(api, 'undo');
  assert.equal(stuck.result.ok, true);
  const nothing = await invoke(api, 'undo');
  assert.equal(nothing.ok, false);
  assert.equal(nothing.result, undefined);
  assert.equal(nothing.error.code, 'nothing_to_undo');
  assert.equal(env.history().head, 0);
});

test('refused commands return an error envelope and do not commit', async () => {
  const env = world();
  const api = createSurfcadBridge(env.host);
  await invoke(api, 'set_script', { source: BOX });

  const unknown = await invoke(api, 'getScript');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'unknown_command');

  const badJson = await api.call('set_script', '{');
  assert.deepEqual(JSON.parse(JSON.stringify(badJson)), badJson);
  assert.equal(badJson.ok, false);
  assert.equal(badJson.error.code, 'bad_json');

  const arrayArgs = await api.call('run', '[1]');
  assert.equal(arrayArgs.error.code, 'bad_args');

  const typed = await api.call('run', { n: new Float64Array([1, 2, 3]) });
  assert.equal(typed.ok, false);
  assert.equal(typed.error.code, 'bad_args');

  const infinite = await api.call('run', { n: Infinity });
  assert.equal(infinite.error.code, 'bad_args');

  const instance = await api.call('run', new Date());
  assert.equal(instance.error.code, 'bad_args');

  const missing = await invoke(api, 'set_script', {});
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'bad_args');

  const wrong = await invoke(api, 'set_script', { source: 1 });
  assert.equal(wrong.error.code, 'bad_args');

  const format = await invoke(api, 'screenshot', { format: 'jpg' });
  assert.equal(format.ok, false);
  assert.equal(format.error.code, 'unsupported_format');

  assert.equal(env.history().head, 0);
  assert.equal(env.history().commits.length, 1);
  assert.equal(env.buffer(), BOX);
  assert.equal(env.calls.execute, 1);
});

test('a failed screenshot is an envelope error', async () => {
  const missing = world({ screenshot: null });
  const blank = await invoke(createSurfcadBridge(missing.host), 'screenshot', { format: 'png' });
  assert.equal(blank.ok, false);
  assert.equal(blank.error.code, 'screenshot_failed');

  const throwing = world();
  throwing.host.screenshot = () => { throw new Error('viewport gone'); };
  const shot = await invoke(createSurfcadBridge(throwing.host), 'screenshot');
  assert.equal(shot.ok, false);
  assert.equal(shot.error.code, 'screenshot_failed');
  assert.match(shot.error.message, /viewport gone/);
});

test('convenience methods unwrap call() and throw on a refused command', async () => {
  const env = world();
  const api = createSurfcadBridge(env.host);
  assert.equal(await api.getScript(), '');
  assert.deepEqual(await api.errors(), []);
  assert.equal((await api.status()).volume, null);

  const viaCall = await api.call('set_script', { source: BOX });
  const viaWrap = await api.setScript(BOX);
  assert.equal(viaCall.ok, true);
  assert.deepEqual(viaWrap, viaCall.result);
  assert.equal(env.history().head, 0);
  assert.equal(env.history().commits.length, 1);

  const ran = await api.run();
  assert.deepEqual(ran, (await api.call('run')).result);
  assert.equal(await api.getScript(), BOX);
  assert.equal((await api.status()).featureCount, 1);
  assert.deepEqual(await api.errors(), []);
  assert.equal(await api.screenshot(), 'data:image/png;base64,iVBORw0KGgo=');

  await assert.rejects(api.setScript(1), (err) => err.code === 'bad_args');
  assert.equal(env.history().head, 0);
  assert.equal(env.buffer(), BOX);

  await api.setScript(HOLE);
  const undone = await api.undo();
  assert.equal(undone.ok, true);
  assert.equal(await api.getScript(), BOX);
  await assert.rejects(api.undo(), (err) => err.code === 'nothing_to_undo');
  assert.equal(env.history().head, 0);
});

test('a host throw during execute stays a CAD result, and a throw outside it is internal', async () => {
  const executed = world();
  executed.host.execute = async () => { throw new Error('kernel'); };
  const ran = await invoke(createSurfcadBridge(executed.host), 'set_script', { source: BOX });
  assert.equal(ran.ok, true);
  assert.equal(ran.result.ok, false);
  assert.deepEqual(ran.result.errors, ['kernel']);

  const editor = world();
  editor.host.setEditor = () => { throw new Error('editor down'); };
  const refused = await invoke(createSurfcadBridge(editor.host), 'run');
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, 'internal');
  assert.match(refused.error.message, /editor down/);
});

test('reads do not wait for a queued mutation', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const env = world();
  const orig = env.host.execute;
  env.host.execute = async (src) => {
    await gate;
    return orig(src);
  };
  const api = createSurfcadBridge(env.host);
  const pending = api.call('set_script', JSON.stringify({ source: BOX }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const status = await api.call('status', '{}');
  assert.equal(status.ok, true);
  assert.equal(status.result.volume, null);
  const script = await api.call('get_script', '{}');
  assert.equal(script.result.source, BOX);
  release();
  const wrote = await pending;
  assert.equal(wrote.result.ok, true);
  assert.equal((await api.call('status', '{}')).result.volume, 24000);
});

test('list_commands returns name, schema, and example and does not commit', async () => {
  const env = world();
  const api = createSurfcadBridge(env.host);
  await invoke(api, 'set_script', { source: BOX });
  const listed = await invoke(api, 'list_commands', { extra: true });
  assert.equal(listed.ok, true);
  assert.equal(listed.result.commands.length, COMMANDS.length);
  assert.deepEqual(listed.result.commands.map((command) => command.name), COMMANDS);
  for (const command of listed.result.commands) {
    assert.equal(typeof command.name, 'string');
    assert.equal(command.schema.type, 'object');
    assert.equal(typeof command.example, 'object');
    assert.equal(command.example != null && !Array.isArray(command.example), true);
    assert.equal('uiEntry' in command, false);
    assert.equal('run' in command, false);
  }
  const setScript = listed.result.commands.find((command) => command.name === 'set_script');
  assert.deepEqual(setScript.schema.required, ['source']);
  assert.equal(setScript.schema.properties.source.type, 'string');
  assert.equal(typeof setScript.example.source, 'string');
  const shot = listed.result.commands.find((command) => command.name === 'screenshot');
  assert.deepEqual(shot.schema.properties.format.enum, ['png']);
  assert.deepEqual(shot.example, { format: 'png' });
  assert.equal(env.history().head, 0);
  assert.equal(env.history().commits.length, 1);
  assert.equal(env.calls.execute, 1);
  assert.deepEqual(await api.listCommands(), listed.result.commands);
});

test('list_commands does not wait for a queued mutation', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const env = world();
  const orig = env.host.execute;
  env.host.execute = async (src) => {
    await gate;
    return orig(src);
  };
  const api = createSurfcadBridge(env.host);
  const pending = api.call('set_script', JSON.stringify({ source: BOX }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const listed = await api.call('list_commands', '{}');
  assert.equal(listed.ok, true);
  assert.equal(listed.result.commands[0].name, 'get_script');
  assert.equal(listed.result.commands[7].name, 'list_commands');
  assert.equal(listed.result.commands.at(-1).name, 'zoom_to_selection');
  release();
  await pending;
});

test('state readers resolve from the host ref at call time', async () => {
  const ref = {
    current: {
      getScript: () => '',
      setEditor() {},
      readHistory: () => emptyPartHistory(),
      writeHistory() {},
      async execute() {
        return { ok: true, errors: [], volume: 1, bbox: null, partName: 'Part (1)' };
      },
      screenshot: () => 'data:image/png;base64,iVBORw0KGgo=',
    },
  };
  const api = createSurfcadBridge({ resolve: () => ref.current });
  const empty = await api.call('feature_tree', '{}');
  assert.equal(empty.ok, true);
  assert.equal(empty.result.features.length, 0);

  ref.current.readFeatureTree = () => ({
    features: [{ id: 'cube1', kind: 'cube', index: 0 }],
    rollbackAnchor: null,
    activeChipId: null,
  });
  ref.current.readParts = () => ({
    activeId: 'local:part1',
    assemblyName: 'box',
    parts: [{ id: 'local:part1', name: 'Part (1)', visible: true }],
  });
  ref.current.readCamera = () => ({
    position: [1, 2, 3],
    quaternion: [0, 0, 0, 1],
    target: [0, 0, 0],
    zoom: 1,
    fov: 45,
  });
  ref.current.readDirty = () => ({
    workspaceDirty: true,
    assemblyDirty: false,
    renamePending: false,
    legacyCleanup: false,
    partIds: ['local:part1'],
  });

  const tree = await api.call('feature_tree', '{}');
  assert.equal(tree.result.features.length, 1);
  assert.equal((await api.call('parts', '{}')).result.parts.length, 1);
  assert.deepEqual((await api.call('camera', '{}')).result.position, [1, 2, 3]);
  assert.equal((await api.call('dirty', '{}')).result.workspaceDirty, true);
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
