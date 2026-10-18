import assert from 'node:assert/strict';
import test from 'node:test';
import { mintSurfId } from './surfId.js';
import { parseSurfJson, validateSurfJson } from './surfJson.js';
import { parseSurfJsonV2, validateSurfJsonV2 } from './surfJsonV2.js';

const ASM = mintSurfId({ now: new Date('2026-10-18T02:50:00.001Z'), rand: 'aa01' });
const PART = mintSurfId({ now: new Date('2026-10-18T02:50:00.002Z'), rand: 'bb02' });
const OTHER = mintSurfId({ now: new Date('2026-10-18T02:50:00.003Z'), rand: 'cc03' });
const GROUP = mintSurfId({ now: new Date('2026-10-18T02:50:00.004Z'), rand: 'dd04' });

function v1Fixture() {
  return {
    format: 'surfcad.assembly',
    version: 1,
    name: 'Gearbox',
    activeId: 'parts/Bracket.js',
    parts: [{
      id: PART,
      path: 'parts/Bracket.js',
      name: 'Bracket',
      visible: true,
      order: 0,
    }],
  };
}

function v2Fixture(patch = {}, partPatch = {}) {
  return {
    format: 'surfcad.assembly',
    version: 2,
    id: ASM,
    name: 'Gearbox',
    activeId: PART,
    parts: [{
      id: PART,
      name: 'Bracket',
      visible: true,
      order: 0,
      ...partPatch,
    }],
    ...patch,
  };
}

test('v2 fixtures validate and parse', () => {
  const raw = v2Fixture({
    name: 'Kettle Lid',
    groups: [{
      id: GROUP,
      name: 'Cover',
      source: OTHER,
      partIds: [PART],
    }],
  });
  const check = validateSurfJsonV2(raw);
  assert.equal(check.ok, true, check.errors?.join('; '));
  const doc = parseSurfJsonV2(raw);
  assert.equal(doc.id, ASM);
  assert.equal(doc.name, 'Kettle Lid');
  assert.equal(doc.activeId, PART);
  assert.equal(doc.parts[0].id, PART);
  assert.equal(doc.parts[0].path, undefined);
  assert.equal(doc.groups[0].source, OTHER);
});

test('v1 fixtures still validate in the legacy parser', () => {
  const raw = v1Fixture();
  const check = validateSurfJson(raw);
  assert.equal(check.ok, true, check.errors?.join('; '));
  const doc = parseSurfJson(raw);
  assert.equal(doc.parts[0].id, PART);
  assert.equal(doc.parts[0].path, 'parts/Bracket.js');
});

test('v2 file is rejected by the v1 parser and vice versa', () => {
  const v2 = v2Fixture();
  const v1 = v1Fixture();
  const v1OnV2 = validateSurfJson(v2);
  assert.equal(v1OnV2.ok, false);
  assert.ok(v1OnV2.errors.some((line) => /version must be 1/.test(line)));
  assert.throws(() => parseSurfJson(v2), /Invalid \.surf\.json/);

  const v2OnV1 = validateSurfJsonV2(v1);
  assert.equal(v2OnV1.ok, false);
  assert.ok(v2OnV1.errors.some((line) => /version must be 2/.test(line)));
  assert.ok(v2OnV1.errors.some((line) => /id is required/.test(line)));
  assert.ok(v2OnV1.errors.some((line) => /path is forbidden/.test(line)));
  assert.throws(() => parseSurfJsonV2(v1), /Invalid \.surf\.json/);
});

test('v2 validation rejects path and a missing id', () => {
  const withPath = validateSurfJsonV2(v2Fixture({}, { path: `parts/${PART}.js` }));
  assert.equal(withPath.ok, false);
  assert.ok(withPath.errors.some((line) => line.includes('path is forbidden')));

  const noPartId = validateSurfJsonV2(v2Fixture({}, { id: undefined }));
  assert.equal(noPartId.ok, false);
  assert.ok(noPartId.errors.some((line) => line.includes('id is required')));

  const { id: _drop, ...noTopId } = v2Fixture();
  const missingTop = validateSurfJsonV2(noTopId);
  assert.equal(missingTop.ok, false);
  assert.ok(missingTop.errors.some((line) => line === 'id is required'));
});

test('v2 name is a label, not a path segment', () => {
  const raw = v2Fixture({ name: 'Gearbox / Cover' });
  const check = validateSurfJsonV2(raw);
  assert.equal(check.ok, true, check.errors?.join('; '));
  const v1Name = validateSurfJson({ ...v1Fixture(), name: 'Gearbox / Cover' });
  assert.equal(v1Name.ok, false);
  assert.ok(v1Name.errors.some((line) => /path-safe/.test(line)));
});
