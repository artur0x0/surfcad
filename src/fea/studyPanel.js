/**
 * Pure study-panel logic: material badges, face toggle, load vectors,
 * the solver request, and the stub summary. No React and no worker.
 *
 * Face identity is the paint fingerprint (`at`, `n`, `area`, and `src` /
 * `ord` on a fillet or chamfer). Matching goes through faceColorMatch.js
 * so a rebuild finds the same face the painter would.
 */

import { matchFaceKeys } from '../utils/faceColorMatch.js';
import { detectContacts, mergeContactPairs } from './contactDetect.js';
import { effectiveMaterial, getMaterial, listMaterials } from './materials.js';
import { partMaterialEntries } from './partMaterial.js';
import { placementMatrix, transformPositions } from './partTransform.js';
import { defaultStudy, validateStudy } from './studySchema.js';

export const FORCE_DIRECTIONS = Object.freeze([
  { value: 'normal', label: 'Normal' },
  { value: '-normal', label: '−N' },
  { value: '+x', label: '+X' },
  { value: '-x', label: '−X' },
  { value: '+y', label: '+Y' },
  { value: '-y', label: '−Y' },
  { value: '+z', label: '+Z' },
  { value: '-z', label: '−Z' },
]);

const AXIS = Object.freeze({
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
});

const NAMED_DIRECTIONS = new Set(['normal', '-normal', ...Object.keys(AXIS), 'custom']);

function unitVector(vector) {
  if (!vector || vector.length < 3) return null;
  const len = Math.hypot(Number(vector[0]), Number(vector[1]), Number(vector[2]));
  if (!(len > 0) || !Number.isFinite(len)) return null;
  return [vector[0] / len, vector[1] / len, vector[2] / len];
}

function sameDirection(a, b) {
  const ua = unitVector(a);
  const ub = unitVector(b);
  if (!ua || !ub) return false;
  const dot = ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2];
  return dot >= 0.999;
}

/** The picker token that matches this vector, or `custom`. */
export function namedDirection(vector, normal) {
  const unit = unitVector(vector);
  if (!unit) return null;
  for (const [label, axis] of Object.entries(AXIS)) {
    if (sameDirection(unit, axis)) return label;
  }
  const n = unitVector(normal);
  if (n && sameDirection(unit, n)) return 'normal';
  if (n && sameDirection(unit, [-n[0], -n[1], -n[2]])) return '-normal';
  return 'custom';
}

function storedDirection(direction) {
  return NAMED_DIRECTIONS.has(direction) && direction !== 'custom' ? direction : 'normal';
}

export function emptyDraft() {
  return {
    target: 'fixture',
    magnitudeN: 200,
    direction: 'normal',
    pressureMPa: 1,
    customMode: false,
    custom: { name: '', E_MPa: '', nu: '', yield_MPa: '' },
  };
}

/** Library fields whose ν or yield is assumed or missing. */
export function assumptionFields(entry) {
  if (!entry) return [];
  const fields = [];
  const unverified = Array.isArray(entry.unverified) ? entry.unverified : [];
  if (entry.nu == null || entry.nuSource === 'assumed' || unverified.includes('nu')) fields.push('nu');
  if (entry.yield_MPa == null || unverified.includes('yield_MPa')) fields.push('yield');
  return fields;
}

function typedNumber(value) {
  if (value == null) return NaN;
  if (typeof value === 'string' && value.trim() === '') return NaN;
  return Number(value);
}

export function customAssumptionFields(custom) {
  const fields = [];
  const nu = typedNumber(custom?.nu);
  const yieldMPa = typedNumber(custom?.yield_MPa);
  if (!(nu >= 0) || !(nu < 0.5)) fields.push('nu');
  if (!(yieldMPa > 0)) fields.push('yield');
  return fields;
}

export function faceKeyOf(face) {
  if (!face) return null;
  const key = {
    at: face.at,
    n: face.n,
    area: face.area,
  };
  if (Number.isInteger(face.src) && face.src < 0) {
    key.src = face.src;
    if (Number.isInteger(face.ord) && face.ord >= 0) key.ord = face.ord;
  }
  return key;
}

function asFingerprint(face) {
  const probe = {
    id: Number.isInteger(face.faceID) ? face.faceID : 0,
    tris: Array.isArray(face.tris) ? face.tris : [],
    at: face.at,
    n: face.n,
    area: face.area,
  };
  if (Number.isInteger(face.src) && face.src < 0) {
    probe.src = face.src;
    if (Number.isInteger(face.ord) && face.ord >= 0) probe.ord = face.ord;
  }
  return probe;
}

/** True when paint's matcher would call these the same face. */
export function sameStudyFace(a, b) {
  if (!a || !b || !a.at || !b.at) return false;
  if ((a.part || b.part) && a.part !== b.part) return false;
  const key = faceKeyOf(a);
  if (!key) return false;
  return matchFaceKeys([asFingerprint(b)], [{ key }]).matched.length === 1;
}

/**
 * The study face stored in the script. `pick` is a paint pick
 * (`{ key, indices }`). `faceID` is the Manifold id for that patch.
 */
export function studyFaceFromPick(pick, faceID) {
  const key = pick?.key;
  const at = key?.at;
  const n = key?.n;
  const area = Number(key?.area);
  const id = Number(faceID);
  if (!at || !n || !(area > 0) || !Number.isInteger(id) || id < 0) return null;
  const face = {
    faceID: id,
    at: [at[0], at[1], at[2]],
    n: [n[0], n[1], n[2]],
    area,
  };
  if (Number.isInteger(key.src) && key.src < 0) {
    face.src = key.src;
    if (Number.isInteger(key.ord) && key.ord >= 0) face.ord = key.ord;
  }
  return face;
}

/** Majority per-triangle faceID on the picked triangles. */
export function majorityFaceId(indices, faceIDs) {
  if (!indices?.length || !faceIDs) return 0;
  const counts = new Map();
  for (let i = 0; i < indices.length; i++) {
    const id = Number(faceIDs[indices[i]]);
    if (!Number.isInteger(id) || id < 0) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  let best = 0;
  let n = -1;
  for (const [id, count] of counts) {
    if (count > n) {
      best = id;
      n = count;
    }
  }
  return best;
}

export function forceVector(direction, magnitudeN, normal) {
  const mag = Number(magnitudeN);
  if (!(mag !== 0) || !Number.isFinite(mag)) return null;
  let dir = AXIS[direction];
  if (direction === 'normal' || direction === '-normal') {
    const n = Array.isArray(normal) ? normal : null;
    if (!n || n.length < 3) return null;
    const sign = direction === '-normal' ? -1 : 1;
    dir = [n[0] * sign, n[1] * sign, n[2] * sign];
  }
  if (!dir) return null;
  return dir.map((component) => {
    const value = component * mag;
    return value === 0 ? 0 : value;
  });
}

function patched(study, patch) {
  const result = validateStudy({ ...study, ...patch, result: null });
  if (!result.ok) return { ok: false, errors: result.errors, study };
  return { ok: true, errors: [], study: result.study };
}

export function studyWithMaterialId(study, id) {
  return patched(study, { material: { id } });
}

export function studyWithType(study, type) {
  if (type !== 'linear-static' && type !== 'modal') {
    return { ok: false, errors: ['study.type must be "linear-static" or "modal"'], study: null };
  }
  return patched(study, { type });
}

export function studyScopeKind(study) {
  const kind = study?.scope?.kind;
  return kind === 'assembly' || kind === 'parts' ? kind : 'part';
}

function selectedIds(study, rows) {
  if (studyScopeKind(study) === 'parts') return (study.scope.ids || []).map((id) => String(id));
  if (studyScopeKind(study) === 'assembly') return (rows || []).map((row) => String(row.id));
  return [];
}

/** World-frame copies so a moved, rotated, or scaled part meets its neighbour. */
export function worldSurfaces(rows) {
  const out = [];
  for (const row of rows || []) {
    const mesh = meshArraysFromGeometry(row.geometry, row.faceIDs);
    if (!mesh) continue;
    const matrix = placementMatrix(row);
    const positions = matrix ? transformPositions(mesh.positions, matrix) : mesh.positions;
    out.push({ id: String(row.id), positions, indices: mesh.indices, faceIDs: mesh.faceIDs });
  }
  return out;
}

function withPartRows(study, rows, scriptFor) {
  const ids = selectedIds(study, rows);
  const chosen = (rows || []).filter((row) => ids.includes(String(row.id)));
  return partMaterialEntries(chosen, study.material, scriptFor);
}

/**
 * `scope.kind` is `part`, `assembly`, or `parts`. Assembly fills every
 * visible part. `parts` keeps `scope.ids`. Contacts are re-detected for
 * either multi-part kind and a pair the user disabled stays off.
 */
export function studyWithScope(study, scope, rows, scriptFor) {
  const kind = scope?.kind === 'assembly' || scope?.kind === 'parts' ? scope.kind : 'part';
  if (kind === 'part') {
    return patched(study, { scope: null, parts: [], contacts: [] });
  }
  let ids = (rows || []).map((row) => String(row.id));
  if (kind === 'parts') {
    const wanted = Array.isArray(scope.ids) ? scope.ids.map((id) => String(id)) : ids;
    ids = wanted.filter((id) => ids.includes(id));
    if (ids.length < 2) return patched(study, { scope: null, parts: [], contacts: [] });
  }
  const nextScope = kind === 'assembly' ? { kind: 'assembly' } : { kind: 'parts', ids };
  const drafted = {
    ...study,
    scope: nextScope,
    parts: withPartRows({ ...study, scope: nextScope }, rows, scriptFor),
  };
  const detected = detectContacts(worldSurfaces(
    (rows || []).filter((row) => selectedIds(drafted, rows).includes(String(row.id))),
  ));
  drafted.contacts = mergeContactPairs(detected.pairs, study.contacts || []);
  return patched(drafted, {
    scope: drafted.scope,
    parts: drafted.parts,
    contacts: drafted.contacts,
  });
}

/** After the study material changes, unassigned parts follow the picker. */
export function studyWithResolvedParts(study, rows, scriptFor) {
  if (studyScopeKind(study) === 'part') return { ok: true, errors: [], study };
  const parts = withPartRows(study, rows, scriptFor);
  return patched(study, { parts });
}

export function studyWithContactKind(study, index, kind) {
  const allowed = kind === 'frictionless' || kind === 'frictional' ? kind : 'bonded';
  const contacts = (study?.contacts || []).map((contact, i) => {
    if (i !== index) return contact;
    const next = { ...contact, kind: allowed };
    if (allowed === 'frictional') {
      if (!(typeof next.mu === 'number' && Number.isFinite(next.mu) && next.mu >= 0)) next.mu = 0.2;
    } else {
      delete next.mu;
    }
    return next;
  });
  return patched(study, { contacts });
}

export function studyWithContactMu(study, index, mu) {
  const value = Number(mu);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, errors: ['Friction coefficient must be a finite number greater than or equal to 0'], study };
  }
  const contacts = (study?.contacts || []).map((contact, i) => {
    if (i !== index) return contact;
    return { ...contact, kind: 'frictional', mu: value };
  });
  return patched(study, { contacts });
}

export function studyWithContactEnabled(study, index, enabled) {
  const contacts = (study?.contacts || []).map((contact, i) => {
    if (i !== index) return contact;
    if (enabled === false) return { ...contact, enabled: false };
    const next = { ...contact };
    delete next.enabled;
    return next;
  });
  return patched(study, { contacts });
}

export function studyWithCustomMaterial(study, custom) {
  const material = {
    E_MPa: Number(custom.E_MPa),
    nu: Number(custom.nu),
    yield_MPa: Number(custom.yield_MPa),
  };
  const name = typeof custom.name === 'string' ? custom.name.trim() : '';
  if (name) material.name = name;
  const density = Number(custom.density_kg_m3);
  if (density > 0) material.density_kg_m3 = density;
  return patched(study, { material });
}

function withoutFace(list, face, kind) {
  return list.filter((item) => {
    if (kind && item.kind !== kind) return true;
    return !(item.faces || []).some((row) => sameStudyFace(row, face));
  });
}

/**
 * Tap adds one fixture or one load on that face. Tap the same face again
 * for the same target and it comes off. Other targets keep the face.
 */
export function applyFacePick(study, draft, face) {
  const target = draft?.target;
  if (target === 'fixture') {
    const had = study.fixtures.some((item) => (item.faces || []).some((row) => sameStudyFace(row, face)));
    const fixtures = had
      ? withoutFace(study.fixtures, face, 'fixed')
      : study.fixtures.concat([{ kind: 'fixed', faces: [face] }]);
    return patched(study, { fixtures });
  }
  if (target === 'force') {
    const had = study.loads.some((item) => item.kind === 'force' && (item.faces || []).some((row) => sameStudyFace(row, face)));
    if (had) return patched(study, { loads: withoutFace(study.loads, face, 'force') });
    const vector = forceVector(draft.direction, draft.magnitudeN, face.n);
    if (!vector) return { ok: false, errors: ['Give a non-zero force in newtons'], study };
    const loads = study.loads.concat([{
      kind: 'force',
      faces: [face],
      vector,
      direction: storedDirection(draft.direction),
    }]);
    return patched(study, { loads });
  }
  if (target === 'pressure') {
    const had = study.loads.some((item) => item.kind === 'pressure' && (item.faces || []).some((row) => sameStudyFace(row, face)));
    if (had) return patched(study, { loads: withoutFace(study.loads, face, 'pressure') });
    const pressure = Number(draft.pressureMPa);
    if (!Number.isFinite(pressure) || pressure === 0) {
      return { ok: false, errors: ['Give a non-zero pressure in megapascals'], study };
    }
    const loads = study.loads.concat([{ kind: 'pressure', faces: [face], pressure_MPa: pressure }]);
    return patched(study, { loads });
  }
  return { ok: false, errors: ['Pick Fix, Force, or Pressure'], study };
}

export function studyWithoutFixture(study, index) {
  const fixtures = study.fixtures.filter((_, i) => i !== index);
  return patched(study, { fixtures });
}

export function studyWithoutLoad(study, index) {
  const loads = study.loads.filter((_, i) => i !== index);
  return patched(study, { loads });
}

/** Replace one load vector. The panel commits this once, on pointer-up. */
export function studyWithLoadVector(study, index, vector) {
  const loads = (study?.loads || []).map((load, i) => {
    if (i !== index) return load;
    const nextVector = [Number(vector?.[0]), Number(vector?.[1]), Number(vector?.[2])];
    const direction = namedDirection(nextVector, load.faces?.[0]?.n);
    const next = { ...load, vector: nextVector };
    if (direction) next.direction = direction;
    return next;
  });
  return patched(study, { loads });
}

function scaleToMagnitude(vector, magnitude) {
  const x = Number(vector?.[0]) || 0;
  const y = Number(vector?.[1]) || 0;
  const z = Number(vector?.[2]) || 0;
  const len = Math.hypot(x, y, z);
  if (!(len > 0) || !(magnitude > 0)) return null;
  const scale = magnitude / len;
  return [x, y, z].map((component) => {
    const value = component * scale;
    return value === 0 ? 0 : value;
  });
}

/**
 * Set every force load to `magnitudeN` newtons, keeping its direction.
 * Pressure is left alone. `changed` is false when every force already
 * has that magnitude. The caller commits, which marks the last result stale.
 */
export function studyWithForceMagnitude(study, magnitudeN) {
  const mag = Math.abs(Number(magnitudeN));
  if (!Number.isFinite(mag) || mag === 0) {
    return { ok: false, errors: ['Give a non-zero force in newtons'], study, changed: false };
  }
  let changed = false;
  const loads = (study?.loads || []).map((load) => {
    if (!load || load.kind !== 'force') return load;
    const token = load.direction;
    let vector = token && token !== 'custom'
      ? forceVector(token, mag, load.faces?.[0]?.n)
      : null;
    if (!vector) vector = scaleToMagnitude(load.vector, mag);
    if (!vector) return load;
    const same = Array.isArray(load.vector)
      && load.vector.length === 3
      && load.vector[0] === vector[0]
      && load.vector[1] === vector[1]
      && load.vector[2] === vector[2];
    if (same) return load;
    changed = true;
    return { ...load, vector };
  });
  if (!changed) return { ok: true, errors: [], study, changed: false };
  const next = patched(study, { loads });
  return { ...next, changed: !!next.ok };
}

/**
 * Set every pressure load to `pressureMPa`. Force loads are left alone.
 * `changed` is false when every pressure already has that value.
 */
export function studyWithPressureValue(study, pressureMPa) {
  const pressure = Number(pressureMPa);
  if (!Number.isFinite(pressure) || pressure === 0) {
    return { ok: false, errors: ['Give a non-zero pressure in megapascals'], study, changed: false };
  }
  let changed = false;
  const loads = (study?.loads || []).map((load) => {
    if (!load || load.kind !== 'pressure') return load;
    if (load.pressure_MPa === pressure) return load;
    changed = true;
    return { ...load, pressure_MPa: pressure };
  });
  if (!changed) return { ok: true, errors: [], study, changed: false };
  const next = patched(study, { loads });
  return { ...next, changed: !!next.ok };
}

/**
 * Point every force load along `direction`, keeping each magnitude.
 * Pressure stays on the face normal. `changed` is false when nothing moved.
 */
export function studyWithForceDirection(study, direction) {
  const token = storedDirection(direction);
  if (token !== direction && direction !== 'normal') {
    return { ok: false, errors: ['Pick a load direction'], study, changed: false };
  }
  let changed = false;
  const loads = (study?.loads || []).map((load) => {
    if (!load || load.kind !== 'force') return load;
    const mag = Math.hypot(load.vector?.[0] || 0, load.vector?.[1] || 0, load.vector?.[2] || 0);
    const vector = forceVector(token, mag, load.faces?.[0]?.n);
    if (!vector) return load;
    const sameVec = Array.isArray(load.vector)
      && load.vector.length === 3
      && load.vector[0] === vector[0]
      && load.vector[1] === vector[1]
      && load.vector[2] === vector[2];
    if (load.direction === token && sameVec) return load;
    changed = true;
    return { ...load, direction: token, vector };
  });
  if (!changed) return { ok: true, errors: [], study, changed: false };
  const next = patched(study, { loads });
  return { ...next, changed: !!next.ok };
}

/** Triangle indices for the study faces that still match the live mesh. */
export function highlightIndicesForStudy(fingerprints, study) {
  const faces = [];
  for (const fixture of study?.fixtures || []) faces.push(...(fixture.faces || []));
  for (const load of study?.loads || []) faces.push(...(load.faces || []));
  if (!faces.length || !fingerprints?.length) return [];
  const { matched } = matchFaceKeys(
    fingerprints,
    faces.map((face) => ({ key: faceKeyOf(face) })),
  );
  const indices = [];
  for (const row of matched) {
    const tris = row.face?.tris || [];
    for (let i = 0; i < tris.length; i++) indices.push(tris[i]);
  }
  return indices;
}

function requireModalDensity(study, resolved) {
  if (study?.type !== 'modal') return resolved;
  if (!(resolved.material?.density_kg_m3 > 0)) {
    return {
      ok: false,
      errors: ['A modal study needs a material density (kg/m³).'],
      material: null,
      assumptions: [],
      warnings: [],
    };
  }
  return resolved;
}

export function solverRequestMaterial(study) {
  const material = study?.material;
  if (!material) return { ok: false, errors: ['Pick a material'], material: null, assumptions: [], warnings: [] };
  if (material.id) {
    try {
      const eff = effectiveMaterial(material.id);
      const entry = getMaterial(material.id);
      return requireModalDensity(study, {
        ok: true,
        errors: [],
        material: {
          E_MPa: eff.E_MPa,
          nu: eff.nu,
          yield_MPa: eff.yield_MPa,
          density_kg_m3: eff.density_kg_m3,
        },
        assumptions: eff.assumptions || [],
        warnings: eff.warnings || [],
        anisotropic: entry?.anisotropic === true,
      });
    } catch (err) {
      return { ok: false, errors: [err.message], material: null, assumptions: [], warnings: [] };
    }
  }
  const custom = studyWithCustomMaterial(defaultStudy(), material);
  if (!custom.ok) return { ok: false, errors: custom.errors, material: null, assumptions: [], warnings: [] };
  const resolved = {
    ok: true,
    errors: [],
    material: {
      E_MPa: custom.study.material.E_MPa,
      nu: custom.study.material.nu,
      yield_MPa: custom.study.material.yield_MPa,
    },
    assumptions: [],
    warnings: [],
    anisotropic: false,
  };
  if (custom.study.material.density_kg_m3 > 0) {
    resolved.material.density_kg_m3 = custom.study.material.density_kg_m3;
  }
  return requireModalDensity(study, resolved);
}

function trimNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

/** min / p95 / max in MPa, safety factor, and the stub or missing-yield note. */
export function formatSolveSummary(result) {
  if (!result || typeof result !== 'object') {
    return { stub: false, min: 'n/a', p95: 'n/a', max: 'n/a', fos: 'n/a', warning: 'n/a' };
  }
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const fos = result.safetyFactor != null ? result.safetyFactor : result.fos;
  const fosText = typeof fos === 'number' && Number.isFinite(fos) ? trimNum(fos) : 'n/a';
  const texts = [];
  if (result.source === 'stub') texts.push('STUB, not a real result');
  for (const warning of warnings) {
    if (!warning?.msg) continue;
    if (result.source === 'stub' && warning.code === 'stub') continue;
    texts.push(warning.msg);
  }
  if (fosText === 'n/a' && texts.length === 0) texts.push('n/a');
  return {
    stub: result.source === 'stub',
    min: trimNum(result.min),
    p95: trimNum(result.p95),
    max: trimNum(result.max),
    fos: fosText,
    warning: texts.join(' '),
    governing: typeof result.governingName === 'string' && result.governingName
      ? result.governingName
      : (typeof result.governingPart === 'string' ? result.governingPart : ''),
  };
}

/** Copies the render mesh so solve() can transfer its buffers. */
export function meshArraysFromGeometry(geometry, faceIDs) {
  const positions = geometry?.attributes?.position?.array;
  const index = geometry?.index?.array;
  if (!positions?.length || !index?.length) return null;
  const triangles = Math.floor(index.length / 3);
  let faces;
  if (faceIDs && faceIDs.length >= triangles) faces = Uint32Array.from(faceIDs).subarray(0, triangles);
  else faces = new Uint32Array(triangles);
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(index),
    faceIDs: new Uint32Array(faces),
  };
}

export function libraryOptions() {
  return listMaterials().map((entry) => ({
    id: entry.id,
    name: entry.name,
    assumptions: assumptionFields(entry),
  }));
}

export function studyWithRefine(study, refine) {
  const mesh = { ...(study && study.mesh), refine: refine === 'off' ? 'off' : 'auto' };
  return patched(study, { mesh });
}

/** A new study. Hot-spot refine starts on for phone and desktop. */
export function freshStudy(profile) {
  if (profile !== 'phone' && profile !== 'desktop') return defaultStudy();
  return defaultStudy({
    mesh: { target: 'auto', refine: 'auto' },
  });
}

export function customSeed(study) {
  const material = study?.material;
  if (material?.id) {
    const entry = getMaterial(material.id);
    const eff = effectiveMaterial(material.id);
    return {
      name: entry?.name || '',
      E_MPa: eff.E_MPa,
      nu: eff.nu,
      yield_MPa: eff.yield_MPa == null ? '' : eff.yield_MPa,
    };
  }
  return {
    name: material?.name || '',
    E_MPa: material?.E_MPa ?? '',
    nu: material?.nu ?? '',
    yield_MPa: material?.yield_MPa ?? '',
  };
}
