import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mintSurfId } from './surfId.js';
import { parseSurfJson, validateSurfJson } from './surfJson.js';
import { parseSurfJsonV2, validateSurfJsonV2 } from './surfJsonV2.js';

const ASM = mintSurfId({ now: new Date('2026-10-18T02:50:00.001Z'), rand: 'aa01' });
const PART = mintSurfId({ now: new Date('2026-10-18T02:50:00.002Z'), rand: 'bb02' });
const OTHER = mintSurfId({ now: new Date('2026-10-18T02:50:00.003Z'), rand: 'cc03' });
const GROUP = mintSurfId({ now: new Date('2026-10-18T02:50:00.004Z'), rand: 'dd04' });
const JOINT = mintSurfId({ now: new Date('2026-10-18T02:50:00.005Z'), rand: 'ee05' });
const LOCAL = `local-${PART}`;
const LOCAL_JOINT = `local-${JOINT}`;

function fixedJoint(id = JOINT) {
  return { id, name: 'Ground 1', type: 'fixed', a: { part: PART } };
}

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

function has(errors, text) {
  assert.ok(errors.some((line) => line.includes(text)), `${text} not in ${errors.join(' | ')}`);
}

function matchSchema(schema, value) {
  if (!schema || typeof schema !== 'object') return true;
  if (schema.anyOf) return schema.anyOf.some((alt) => matchSchema(alt, value));
  if (schema.const !== undefined) return Object.is(value, schema.const);
  const type = schema.type;
  if (type === 'null') return value === null;
  if (type === 'string') {
    if (typeof value !== 'string') return false;
    if (schema.minLength != null && value.length < schema.minLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return false;
    if (schema.enum && !schema.enum.includes(value)) return false;
    return true;
  }
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') {
    if (!Number.isInteger(value)) return false;
    if (schema.minimum != null && value < schema.minimum) return false;
    return true;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return false;
    if (schema.minItems != null && value.length < schema.minItems) return false;
    const item = schema.items;
    return item ? value.every((entry) => matchSchema(item, entry)) : true;
  }
  if (type === 'object' || schema.properties || schema.additionalProperties !== undefined) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (schema.minProperties != null && Object.keys(value).length < schema.minProperties) return false;
    if (schema.required) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
      }
    }
    if (schema.propertyNames) {
      for (const key of Object.keys(value)) {
        if (!matchSchema(schema.propertyNames, key)) return false;
      }
    }
    if (schema.properties) {
      for (const [key, child] of Object.entries(schema.properties)) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        if (!matchSchema(child, value[key])) return false;
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) return false;
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const known = new Set(Object.keys(schema.properties || {}));
      for (const [key, child] of Object.entries(value)) {
        if (known.has(key)) continue;
        if (!matchSchema(schema.additionalProperties, child)) return false;
      }
    }
    return true;
  }
  return true;
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
  has(v1OnV2.errors, 'version must be 1');
  assert.throws(() => parseSurfJson(v2), /Invalid \.surf\.json/);

  const v2OnV1 = validateSurfJsonV2(v1);
  assert.equal(v2OnV1.ok, false);
  has(v2OnV1.errors, 'version must be 2');
  has(v2OnV1.errors, 'id is required');
  has(v2OnV1.errors, 'path is forbidden');
  assert.throws(() => parseSurfJsonV2(v1), /Invalid \.surf\.json/);
});

test('v2 validation rejects path, a missing id, and a local- id', () => {
  const withPath = validateSurfJsonV2(v2Fixture({}, { path: `parts/${PART}.js` }));
  assert.equal(withPath.ok, false);
  has(withPath.errors, 'path is forbidden');

  const noPartId = validateSurfJsonV2(v2Fixture({}, { id: undefined }));
  assert.equal(noPartId.ok, false);
  has(noPartId.errors, 'id is required');

  const { id: _drop, ...noTopId } = v2Fixture();
  const missingTop = validateSurfJsonV2(noTopId);
  assert.equal(missingTop.ok, false);
  has(missingTop.errors, 'id is required');

  const localTop = validateSurfJsonV2(v2Fixture({ id: LOCAL }));
  assert.equal(localTop.ok, false);
  has(localTop.errors, 'id must be a surf id');
  const localPart = validateSurfJsonV2(v2Fixture({}, { id: LOCAL }));
  assert.equal(localPart.ok, false);
  has(localPart.errors, 'id must be a surf id');
});

test('v2 name is a label, not a path segment', () => {
  const raw = v2Fixture({ name: 'Gearbox / Cover' });
  const check = validateSurfJsonV2(raw);
  assert.equal(check.ok, true, check.errors?.join('; '));
  const v1Name = validateSurfJson({ ...v1Fixture(), name: 'Gearbox / Cover' });
  assert.equal(v1Name.ok, false);
  has(v1Name.errors, 'path-safe');
});

test('parseSurfJsonV2 keeps activeId null', () => {
  const doc = parseSurfJsonV2(v2Fixture({ activeId: null }));
  assert.equal(doc.activeId, null);
  assert.equal(doc.parts[0].id, PART);
});

test('parseSurfJsonV2 treats a missing activeId key as null', () => {
  const { activeId: _drop, ...raw } = v2Fixture();
  assert.equal(Object.prototype.hasOwnProperty.call(raw, 'activeId'), false);
  const check = validateSurfJsonV2(raw);
  assert.equal(check.ok, true, check.errors?.join('; '));
  const doc = parseSurfJsonV2(raw);
  assert.equal(doc.activeId, null);
  assert.equal(doc.parts[0].id, PART);
});

test('v2 joint ids reject a local- prefix that v1 still accepts', () => {
  const local = validateSurfJsonV2(v2Fixture({ joints: [fixedJoint(LOCAL_JOINT)] }));
  assert.equal(local.ok, false);
  has(local.errors, 'id must be a surf id');
  const ok = validateSurfJsonV2(v2Fixture({ joints: [fixedJoint()] }));
  assert.equal(ok.ok, true, ok.errors?.join('; '));
  const v1 = validateSurfJson({
    ...v1Fixture(),
    joints: [fixedJoint(LOCAL_JOINT)],
  });
  assert.equal(v1.ok, true, v1.errors?.join('; '));
});

test('v2 validation covers version, duplicates, activeId, copiedFrom, and source', () => {
  has(validateSurfJsonV2(v2Fixture({ version: 3 })).errors, 'version must be 2');
  const { version: _v, ...noVersion } = v2Fixture();
  has(validateSurfJsonV2(noVersion).errors, 'version must be 2');

  const dup = v2Fixture({
    parts: [
      { id: PART, name: 'A', visible: true, order: 0 },
      { id: PART, name: 'B', visible: true, order: 1 },
    ],
  });
  has(validateSurfJsonV2(dup).errors, 'id duplicates');

  has(validateSurfJsonV2(v2Fixture({ activeId: OTHER })).errors, 'activeId must be null or one of the part ids');
  has(validateSurfJsonV2(v2Fixture({}, { copiedFrom: 'not-an-id' })).errors, 'copiedFrom must be a surf id');
  has(validateSurfJsonV2(v2Fixture({}, { copiedFrom: LOCAL })).errors, 'copiedFrom must be a surf id');
  has(validateSurfJsonV2(v2Fixture({
    groups: [{
      id: GROUP,
      name: 'Cover',
      source: 'assemblies/Cover/.surf.json',
      partIds: [PART],
    }],
  })).errors, 'source must be a surf id or null');
  has(validateSurfJsonV2(v2Fixture({ name: `Gearbox\u2028Cover` })).errors, 'name must be a non-empty string');
  has(validateSurfJsonV2(v2Fixture({ name: '   ' })).errors, 'name must be a non-empty string');
});

test('catalog defs.v2 matches v2 fixtures', () => {
  const catalogPath = join(dirname(fileURLToPath(import.meta.url)), '../../lib/surfcad/catalog/assembly.schema.json');
  const v2 = JSON.parse(readFileSync(catalogPath, 'utf8')).defs.v2;
  assert.equal(v2.properties.parts.items.properties.name.minLength, 1);
  assert.ok(v2.properties.parts.items.properties.name.pattern.includes('\\S'));
  assert.equal(v2.properties.id.pattern.includes('local-'), false);

  const valid = [
    v2Fixture(),
    v2Fixture({ name: 'Kettle Lid', activeId: null }),
    (() => { const { activeId: _omit, ...raw } = v2Fixture(); return raw; })(),
    v2Fixture({
      groups: [{ id: GROUP, name: 'Cover', source: OTHER, partIds: [PART] }],
    }),
    v2Fixture({ joints: [fixedJoint()] }),
  ];
  for (const raw of valid) {
    assert.equal(validateSurfJsonV2(raw).ok, true, validateSurfJsonV2(raw).errors?.join('; '));
    assert.equal(matchSchema(v2, raw), true, `schema rejected ${JSON.stringify(raw)}`);
  }

  const invalid = [
    v2Fixture({ version: 3 }),
    v2Fixture({ id: LOCAL }),
    v2Fixture({}, { path: `parts/${PART}.js` }),
    v2Fixture({}, { copiedFrom: 'nope' }),
    v2Fixture({
      groups: [{
        id: GROUP,
        name: 'Cover',
        source: 'assemblies/Cover/.surf.json',
        partIds: [PART],
      }],
    }),
    v2Fixture({ name: `Gearbox\u2028Cover` }),
    v2Fixture({ name: '   ' }),
    v2Fixture({ activeId: 'not-an-id' }),
    v2Fixture({ joints: [fixedJoint(LOCAL_JOINT)] }),
  ];
  for (const raw of invalid) {
    assert.equal(validateSurfJsonV2(raw).ok, false, `validator accepted ${JSON.stringify(raw)}`);
    assert.equal(matchSchema(v2, raw), false, `schema accepted ${JSON.stringify(raw)}`);
  }
});
