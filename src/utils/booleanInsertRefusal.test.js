import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runScript } from '../lib/surfcad/index.js';
import { BOOLEAN_INSERT_NEED_TOOL, booleanInsertRefusal } from './booleanMode.js';
import { composeHelperInsert } from './helperPaletteSnippets.js';

/**
 * Bug 25. Cube plus a second solid with merge:false is two bodies.
 * insert_boolean { op:'union' } makes one. A second insert_boolean used to
 * write boolean2, then booleanBodies threw
 * "booleanBodies: pick a target and at least one tool body" and left the
 * failed block in the script. The guard refuses before compose.
 * The Test Lead's second solid was an extrude; the kernel sees the same
 * one-body part either way.
 */

const NEED = 'booleanBodies: pick a target and at least one tool body';

function twoBodyScript() {
  let script = composeHelperInsert('', 'cube', null, { width: 20, depth: 20, height: 20 });
  // Overlap the first cube. A gap stays two bodies after union, which is
  // not the one-solid part the second insert_boolean fails on.
  script = composeHelperInsert(script, 'cube', null, {
    width: 10, depth: 10, height: 8, combine: 'add', merge: false, z: 0,
  });
  return script;
}

/** What prepareHelperInsert does for helperId boolean: refuse, or compose. */
function guardedBooleanInsert(script, bodyCount, params) {
  const why = booleanInsertRefusal(bodyCount, params);
  if (why) return { error: { code: 'insert_failed', message: why }, source: script };
  return { source: composeHelperInsert(script, 'boolean', null, params) };
}

function booleanCallCount(script) {
  return (String(script).match(/booleanBodies\s*\(/g) || []).length;
}

test('booleanInsertRefusal matches the kernel sentence and ignores unused picks', () => {
  assert.equal(BOOLEAN_INSERT_NEED_TOOL, NEED);
  assert.equal(booleanInsertRefusal(2, { op: 'union' }), null);
  assert.equal(booleanInsertRefusal(1, { op: 'union' }), NEED);
  assert.equal(booleanInsertRefusal(0, { op: 'union' }), NEED);
  assert.equal(booleanInsertRefusal(null, { op: 'union' }), null);
  assert.equal(booleanInsertRefusal(undefined, { op: 'union' }), null);
  assert.equal(booleanInsertRefusal(Number.NaN, { op: 'union' }), null);
  // params.body is the script variable. A bodies/tools field is not written
  // by the sequential composer, so a one-body part still refuses.
  assert.equal(booleanInsertRefusal(1, { op: 'union', body: 'part' }), NEED);
  assert.equal(booleanInsertRefusal(1, { op: 'difference', bodies: [{ at: [0, 0, 0] }] }), NEED);
  assert.equal(booleanInsertRefusal(1, { op: 'union', tools: [{}] }), NEED);
  assert.equal(booleanInsertRefusal(2, { op: 'union', bodies: [{ at: [0, 0, 0] }] }), null);
});

test('second insert_boolean on one body is refused and the script is unchanged', async () => {
  const script = twoBodyScript();
  const two = await runScript(script);
  assert.equal(two.status, 'NoError');
  assert.equal(two.bodyCount, 2);
  assert.equal(booleanCallCount(script), 0);

  const first = guardedBooleanInsert(script, two.bodyCount, { op: 'union' });
  assert.equal(first.error, undefined);
  assert.equal(booleanCallCount(first.source), 1);
  const unioned = await runScript(first.source);
  assert.equal(unioned.status, 'NoError');
  assert.equal(unioned.bodyCount, 1);
  assert.equal(unioned.featureSkip ?? null, null);

  const second = guardedBooleanInsert(first.source, unioned.bodyCount, { op: 'union' });
  assert.deepEqual(second.error, { code: 'insert_failed', message: NEED });
  assert.equal(second.source, first.source);
  assert.equal(booleanCallCount(second.source), 1);

  // The unguarded composer still writes the block, and that run reports the
  // same sentence. The guard is what keeps boolean2 out of the tree.
  const wouldWrite = composeHelperInsert(first.source, 'boolean', null, { op: 'union' });
  assert.equal(booleanCallCount(wouldWrite), 2);
  let reported = '';
  try {
    const ran = await runScript(wouldWrite);
    reported = ran.featureSkip?.message || ran.status || '';
  } catch (err) {
    reported = err?.message || String(err);
  }
  assert.match(reported, /pick a target and at least one tool body/);
});

test('prepareHelperInsert refuses a one-body boolean before it composes', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const start = app.indexOf('prepareHelperInsert(');
  const end = app.indexOf('prepareContourMutate', start);
  const body = app.slice(start, end);
  const guard = body.indexOf('booleanInsertRefusal');
  const compose = body.indexOf('composeHelperInsert');
  assert.ok(guard > 0 && compose > guard, 'the refusal runs before compose');
  assert.match(body, /code: 'insert_failed'/);
});
