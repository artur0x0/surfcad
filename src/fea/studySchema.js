/**
 * Versioned FEA study stored in a part script.
 *
 * A study names a material, the faces that are fixed, and the faces that
 * carry a force (newtons, as a vector) or a pressure (megapascals). Each
 * face keeps the mesh faceID plus the fingerprint face paint uses to find
 * the same face after a rebuild: `at` (mm), `n` (unit normal), `area`
 * (mm²), and for a fillet or chamfer face `src` / `ord`
 * (see faceColorMatch.js). Results are never stored; `result` is null.
 *
 * Units are the part-script units: length mm, force N, stress MPa.
 */

import { DEFAULT_FRICTION } from './contactDetect.js';
import { getMaterial, listMaterials } from './materials.js';

export const STUDY_VERSION = 1;

export const UNITS_NOTE = 'Length is mm, force is N, and stress, pressure, modulus, and yield are MPa. Face area is mm^2 and the face point at is mm.';

const STUDY_KEYS = new Set(['v', 'id', 'name', 'type', 'units', 'material', 'model', 'fixtures', 'loads', 'mesh', 'scope', 'parts', 'contacts', 'result']);
const UNIT_KEYS = new Set(['length', 'force', 'stress', 'note']);
const MATERIAL_ID_KEYS = new Set(['id']);
const MATERIAL_CUSTOM_KEYS = new Set(['name', 'E_MPa', 'nu', 'yield_MPa', 'density_kg_m3']);
const MESH_KEYS = new Set(['target', 'refine']);
const FIXTURE_KEYS = new Set(['kind', 'faces']);
const LOAD_KEYS = new Set(['kind', 'faces', 'vector', 'pressure_MPa', 'direction']);
const LOAD_DIRECTIONS = new Set(['normal', '-normal', '+x', '-x', '+y', '-y', '+z', '-z', 'custom']);
const FACE_KEYS = new Set(['faceID', 'part', 'at', 'n', 'area', 'src', 'ord']);
const SCOPE_KEYS = new Set(['kind', 'ids']);
const PART_ENTRY_KEYS = new Set(['id', 'material']);
const CONTACT_KEYS = new Set(['a', 'b', 'kind', 'enabled', 'mu']);
const CONTACT_KINDS = new Set(['bonded', 'frictionless', 'frictional']);
const CONTACT_END_KEYS = new Set(['part', 'faceID']);

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export class StudyValidationError extends Error {
  constructor(errors) {
    super(errors && errors.length ? errors[0] : 'invalid study');
    this.name = 'StudyValidationError';
    this.errors = errors || [];
  }
}

function isPlain(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function unknownKeys(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function vec3(value, path, errors, { unit = false } = {}) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finiteNumber)) {
    errors.push(`${path} must be three finite numbers`);
    return null;
  }
  if (unit) {
    const len = Math.hypot(value[0], value[1], value[2]);
    if (!(Math.abs(len - 1) <= 1e-3)) {
      errors.push(`${path} must be a unit vector (length ${len}); use the face-paint fingerprint (at, n, area)`);
    }
  }
  return [value[0], value[1], value[2]];
}

function rejectMarkerText(value, path, errors) {
  if (typeof value !== 'string') return;
  if (value.includes('\n') || value.includes('\r') || value.includes('// ---')) {
    errors.push(`${path} must be a single line and must not contain a feature marker`);
  }
}

function partIdOk(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 240
    && !value.includes('\n')
    && !value.includes('\r')
    && !value.includes('// ---');
}

function canonicalFace(face) {
  const out = {
    faceID: face.faceID,
    at: [face.at[0], face.at[1], face.at[2]],
    n: [face.n[0], face.n[1], face.n[2]],
    area: face.area,
  };
  if (face.part) out.part = face.part;
  if (face.src != null) out.src = face.src;
  if (face.ord != null) out.ord = face.ord;
  return out;
}

function readFace(face, path, errors) {
  if (!isPlain(face)) {
    errors.push(`${path} must be an object with faceID, at, n, and area`);
    return null;
  }
  for (const key of unknownKeys(face, FACE_KEYS)) errors.push(`${path} unknown key "${key}"`);
  if (!Number.isInteger(face.faceID) || face.faceID < 0) {
    errors.push(`${path}.faceID must be a non-negative integer`);
  }
  const at = vec3(face.at, `${path}.at`, errors);
  const n = vec3(face.n, `${path}.n`, errors, { unit: true });
  if (!finiteNumber(face.area) || !(face.area > 0)) {
    errors.push(`${path}.area must be a positive finite area in mm^2`);
  }
  const hasSrc = face.src != null && face.src !== '';
  const hasOrd = face.ord != null && face.ord !== '';
  if (hasSrc && (!Number.isInteger(face.src) || face.src >= 0)) {
    errors.push(`${path}.src must be a negative integer (fillet or chamfer feature key)`);
  }
  if (hasOrd && (!Number.isInteger(face.ord) || face.ord < 0)) {
    errors.push(`${path}.ord must be a non-negative integer`);
  }
  if (hasOrd && !hasSrc) errors.push(`${path}.ord requires src`);
  if (face.part != null && face.part !== '') {
    if (!partIdOk(face.part)) errors.push(`${path}.part must be a part id`);
  }
  if (!at || !n || !Number.isInteger(face.faceID) || !(face.area > 0)) return null;
  const out = { faceID: face.faceID, at, n, area: face.area };
  if (partIdOk(face.part)) out.part = face.part;
  if (hasSrc && Number.isInteger(face.src) && face.src < 0) out.src = face.src;
  if (hasOrd && Number.isInteger(face.ord) && face.ord >= 0) out.ord = face.ord;
  return out;
}

function readFaces(faces, path, errors) {
  if (!Array.isArray(faces) || faces.length === 0) {
    errors.push(`${path} must list at least one face`);
    return [];
  }
  const out = [];
  for (let i = 0; i < faces.length; i++) {
    const face = readFace(faces[i], `${path}[${i}]`, errors);
    if (face) out.push(canonicalFace(face));
  }
  return out;
}

function readMaterial(material, errors) {
  if (!isPlain(material)) {
    errors.push('study.material must be { id } or { E_MPa, nu, yield_MPa }');
    return null;
  }
  const hasId = material.id != null && material.id !== '';
  const hasCustom = ['E_MPa', 'nu', 'yield_MPa', 'name'].some((key) => material[key] != null && material[key] !== '');
  if (hasId && hasCustom) {
    errors.push('study.material must be either { id } or { E_MPa, nu, yield_MPa }, not both');
    return null;
  }
  if (hasId) {
    for (const key of unknownKeys(material, MATERIAL_ID_KEYS)) {
      errors.push(`study.material unknown key "${key}"`);
    }
    if (typeof material.id !== 'string' || !ID_RE.test(material.id)) {
      errors.push('study.material.id must be a material id');
      return null;
    }
    if (!getMaterial(material.id)) {
      const known = listMaterials().map((entry) => entry.id).join(', ');
      errors.push(`unknown material id "${material.id}" (known: ${known})`);
      return null;
    }
    return { id: material.id };
  }
  for (const key of unknownKeys(material, MATERIAL_CUSTOM_KEYS)) {
    errors.push(`study.material unknown key "${key}"`);
  }
  if (!finiteNumber(material.E_MPa) || !(material.E_MPa > 0)) {
    errors.push('study.material.E_MPa must be a positive finite modulus in megapascals');
  }
  if (!finiteNumber(material.nu) || material.nu < 0 || material.nu >= 0.5) {
    errors.push('study.material.nu must be a finite Poisson ratio with 0 <= nu < 0.5');
  }
  if (!finiteNumber(material.yield_MPa) || !(material.yield_MPa > 0)) {
    errors.push('study.material.yield_MPa must be a positive finite yield strength in megapascals');
  }
  if (material.name != null) {
    if (typeof material.name !== 'string' || !material.name.trim()) {
      errors.push('study.material.name must be a non-empty string');
    } else {
      rejectMarkerText(material.name, 'study.material.name', errors);
    }
  }
  if (!finiteNumber(material.E_MPa) || !finiteNumber(material.nu) || !finiteNumber(material.yield_MPa)) return null;
  let density = null;
  if (material.density_kg_m3 != null) {
    if (!finiteNumber(material.density_kg_m3) || !(material.density_kg_m3 > 0)) {
      errors.push('study.material.density_kg_m3 must be a positive finite density in kg/m³');
    } else {
      density = material.density_kg_m3;
    }
  }
  const out = {};
  if (typeof material.name === 'string' && material.name.trim()) out.name = material.name;
  out.E_MPa = material.E_MPa;
  out.nu = material.nu;
  out.yield_MPa = material.yield_MPa;
  if (density != null) out.density_kg_m3 = density;
  return out;
}

function readFixture(fixture, index, errors) {
  const path = `fixtures[${index}]`;
  if (!isPlain(fixture)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  for (const key of unknownKeys(fixture, FIXTURE_KEYS)) errors.push(`${path} unknown key "${key}"`);
  if (fixture.kind !== 'fixed') errors.push(`${path}.kind must be "fixed"`);
  const faces = readFaces(fixture.faces, `${path}.faces`, errors);
  if (fixture.kind !== 'fixed' || !faces.length) return null;
  return { kind: 'fixed', faces };
}

function readDirection(load, path, errors) {
  if (load.direction == null) return undefined;
  if (typeof load.direction !== 'string' || !LOAD_DIRECTIONS.has(load.direction)) {
    errors.push(`${path}.direction must be normal, an axis, or custom`);
    return undefined;
  }
  return load.direction;
}

function readLoad(load, index, errors) {
  const path = `loads[${index}]`;
  if (!isPlain(load)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  for (const key of unknownKeys(load, LOAD_KEYS)) errors.push(`${path} unknown key "${key}"`);
  const faces = readFaces(load.faces, `${path}.faces`, errors);
  if (load.kind === 'force') {
    if (load.pressure_MPa != null) errors.push(`${path} force load must not set pressure_MPa`);
    const vector = vec3(load.vector, `${path}.vector`, errors);
    if (vector && vector[0] === 0 && vector[1] === 0 && vector[2] === 0) {
      errors.push(`${path}.vector is [0, 0, 0]; give the force in newtons`);
    }
    if (!vector || !faces.length) return null;
    const direction = readDirection(load, path, errors);
    const force = { kind: 'force', faces, vector };
    if (direction) force.direction = direction;
    return force;
  }
  if (load.kind === 'pressure') {
    if (load.vector != null) errors.push(`${path} pressure load must not set vector`);
    if (!finiteNumber(load.pressure_MPa) || load.pressure_MPa === 0) {
      errors.push(`${path}.pressure_MPa must be a non-zero finite pressure in megapascals`);
      return null;
    }
    if (!faces.length) return null;
    const direction = readDirection(load, path, errors);
    const pressure = { kind: 'pressure', faces, pressure_MPa: load.pressure_MPa };
    if (direction) pressure.direction = direction;
    return pressure;
  }
  errors.push(`${path}.kind must be "force" or "pressure"`);
  return null;
}

function readScope(scope, errors) {
  if (scope == null) return null;
  if (!isPlain(scope)) {
    errors.push('study.scope must be { kind }');
    return null;
  }
  for (const key of unknownKeys(scope, SCOPE_KEYS)) errors.push(`study.scope unknown key "${key}"`);
  if (scope.kind === 'part' || scope.kind == null) return null;
  if (scope.kind === 'assembly') {
    if (scope.ids != null) errors.push('study.scope.ids is only used when kind is "parts"');
    return { kind: 'assembly' };
  }
  if (scope.kind === 'parts') {
    if (!Array.isArray(scope.ids) || scope.ids.length === 0) {
      errors.push('study.scope.ids must list the selected part ids');
      return null;
    }
    const ids = [];
    const seen = new Set();
    for (let i = 0; i < scope.ids.length; i += 1) {
      if (!partIdOk(scope.ids[i])) {
        errors.push(`study.scope.ids[${i}] must be a part id`);
        continue;
      }
      if (seen.has(scope.ids[i])) continue;
      seen.add(scope.ids[i]);
      ids.push(scope.ids[i]);
    }
    if (!ids.length) return null;
    return { kind: 'parts', ids };
  }
  errors.push('study.scope.kind must be "part", "assembly", or "parts"');
  return null;
}

function readPartEntries(parts, errors) {
  if (parts == null) return [];
  if (!Array.isArray(parts)) {
    errors.push('study.parts must be an array of { id, material }');
    return [];
  }
  const out = [];
  const seen = new Set();
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    const path = `parts[${i}]`;
    if (!isPlain(entry)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    for (const key of unknownKeys(entry, PART_ENTRY_KEYS)) errors.push(`${path} unknown key "${key}"`);
    if (!partIdOk(entry.id)) {
      errors.push(`${path}.id must be a part id`);
      continue;
    }
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const material = readMaterial(entry.material, errors);
    if (!material) continue;
    // readMaterial reports paths as study.material. Retitle the last errors
    // is not worth a second parser; the material object is the same shape.
    out.push({ id: entry.id, material: canonicalMaterial(material) });
  }
  return out;
}

function readContactEnd(end, path, errors) {
  if (!isPlain(end)) {
    errors.push(`${path} must be { part, faceID }`);
    return null;
  }
  for (const key of unknownKeys(end, CONTACT_END_KEYS)) errors.push(`${path} unknown key "${key}"`);
  if (!partIdOk(end.part)) errors.push(`${path}.part must be a part id`);
  if (!Number.isInteger(end.faceID) || end.faceID < 0) {
    errors.push(`${path}.faceID must be a non-negative integer`);
  }
  if (!partIdOk(end.part) || !Number.isInteger(end.faceID) || end.faceID < 0) return null;
  return { part: end.part, faceID: end.faceID };
}

function readContacts(contacts, errors) {
  if (contacts == null) return [];
  if (!Array.isArray(contacts)) {
    errors.push('study.contacts must be an array');
    return [];
  }
  const out = [];
  for (let i = 0; i < contacts.length; i += 1) {
    const row = contacts[i];
    const path = `contacts[${i}]`;
    if (!isPlain(row)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    for (const key of unknownKeys(row, CONTACT_KEYS)) errors.push(`${path} unknown key "${key}"`);
    if (!CONTACT_KINDS.has(row.kind)) {
      errors.push(`${path}.kind must be "bonded", "frictionless", or "frictional"`);
    }
    let mu = null;
    if (row.mu != null) {
      if (!finiteNumber(row.mu) || row.mu < 0) {
        errors.push(`${path}.mu must be a finite friction coefficient greater than or equal to 0`);
      } else {
        mu = row.mu;
      }
    }
    const a = readContactEnd(row.a, `${path}.a`, errors);
    const b = readContactEnd(row.b, `${path}.b`, errors);
    if (row.enabled != null && typeof row.enabled !== 'boolean') {
      errors.push(`${path}.enabled must be a boolean`);
    }
    if (!CONTACT_KINDS.has(row.kind) || !a || !b) continue;
    const contact = { a, b, kind: row.kind };
    if (row.kind === 'frictional') contact.mu = mu == null ? DEFAULT_FRICTION : mu;
    if (row.enabled === false) contact.enabled = false;
    out.push(contact);
  }
  return out;
}

function withDefaults(input) {
  const units = isPlain(input.units) ? input.units : {};
  const mesh = isPlain(input.mesh) ? input.mesh : {};
  return {
    v: input.v ?? STUDY_VERSION,
    id: input.id ?? 's1',
    name: input.name ?? 'Static 1',
    type: input.type ?? 'linear-static',
    units: {
      length: units.length ?? 'mm',
      force: units.force ?? 'N',
      stress: units.stress ?? 'MPa',
      note: units.note ?? UNITS_NOTE,
    },
    material: input.material ?? { id: 'al-6061-t6' },
    model: input.model ?? 'auto',
    fixtures: input.fixtures ?? [],
    loads: input.loads ?? [],
    mesh: meshWithRefine({ target: mesh.target ?? 'auto', refine: mesh.refine }),
    scope: input.scope,
    parts: input.parts,
    contacts: input.contacts,
    result: input.result === undefined ? null : input.result,
  };
}

function canonicalMaterial(material) {
  if (material.id) return { id: material.id };
  const out = {};
  if (material.name) out.name = material.name;
  out.E_MPa = material.E_MPa;
  out.nu = material.nu;
  out.yield_MPa = material.yield_MPa;
  if (material.density_kg_m3 > 0) out.density_kg_m3 = material.density_kg_m3;
  return out;
}

function meshWithRefine(mesh) {
  const out = { target: mesh.target };
  if (mesh.refine != null) out.refine = mesh.refine;
  return out;
}

function canonicalMesh(mesh) {
  const out = { target: mesh.target };
  if (mesh.refine === 'off' || mesh.refine === 'auto') out.refine = mesh.refine;
  return out;
}

function canonicalStudy(study) {
  const out = {
    v: study.v,
    id: study.id,
    name: study.name,
    type: study.type,
    units: {
      length: study.units.length,
      force: study.units.force,
      stress: study.units.stress,
      note: study.units.note,
    },
    material: canonicalMaterial(study.material),
    model: study.model,
    fixtures: study.fixtures,
    loads: study.loads,
    mesh: canonicalMesh(study.mesh),
  };
  if (study.scope) out.scope = study.scope;
  if (study.parts && study.parts.length) out.parts = study.parts;
  if (study.contacts && study.contacts.length) out.contacts = study.contacts;
  out.result = null;
  return out;
}

/**
 * Validate a study. With `defaults: true`, omitted fields become the
 * static-study defaults (id "s1", 6061-T6, empty fixtures and loads).
 * Invalid fields are still errors. Returns `{ ok, errors, study }`.
 */
export function validateStudy(input, { defaults = false } = {}) {
  const errors = [];
  if (!isPlain(input)) return { ok: false, errors: ['study must be an object'], study: null };
  for (const key of unknownKeys(input, STUDY_KEYS)) errors.push(`unknown study key "${key}"`);
  if (isPlain(input.units)) {
    for (const key of unknownKeys(input.units, UNIT_KEYS)) errors.push(`study.units unknown key "${key}"`);
  }
  if (isPlain(input.mesh)) {
    for (const key of unknownKeys(input.mesh, MESH_KEYS)) errors.push(`study.mesh unknown key "${key}"`);
  }
  const src = defaults ? withDefaults(input) : input;

  if (src.v !== STUDY_VERSION) errors.push(`study.v must be ${STUDY_VERSION}`);
  if (typeof src.id !== 'string' || !ID_RE.test(src.id)) {
    errors.push('study.id must be a short id (a letter, then letters, digits, "_" or "-")');
  }
  if (typeof src.name !== 'string' || !src.name.trim()) errors.push('study.name must be a non-empty string');
  else rejectMarkerText(src.name, 'study.name', errors);
  if (src.type !== 'linear-static' && src.type !== 'modal') {
    errors.push('study.type must be "linear-static" or "modal"');
  }

  if (!isPlain(src.units)) {
    errors.push('study.units must be an object');
  } else {
    if (src.units.length !== 'mm') errors.push('study.units.length must be "mm"');
    if (src.units.force !== 'N') errors.push('study.units.force must be "N"');
    if (src.units.stress !== 'MPa') errors.push('study.units.stress must be "MPa"');
    if (src.units.note !== UNITS_NOTE) errors.push('study.units.note must be the standard units note');
  }

  const material = readMaterial(src.material, errors);
  if (!['auto', 'solid', 'shell'].includes(src.model)) {
    errors.push('study.model must be "auto", "solid", or "shell"');
  }

  let fixtures = [];
  if (!Array.isArray(src.fixtures)) errors.push('study.fixtures must be an array');
  else fixtures = src.fixtures.map((fixture, i) => readFixture(fixture, i, errors)).filter(Boolean);

  let loads = [];
  if (!Array.isArray(src.loads)) errors.push('study.loads must be an array');
  else loads = src.loads.map((load, i) => readLoad(load, i, errors)).filter(Boolean);

  if (!isPlain(src.mesh)) errors.push('study.mesh must be an object');
  else {
    const target = src.mesh.target;
    const targetOk = target === 'auto' || (finiteNumber(target) && target > 0);
    if (!targetOk) errors.push('study.mesh.target must be "auto" or a positive element size in mm');
    if (src.mesh.refine != null && src.mesh.refine !== 'off' && src.mesh.refine !== 'auto') {
      errors.push('study.mesh.refine must be "off" or "auto"');
    }
  }

  const scope = readScope(src.scope, errors);
  const parts = readPartEntries(src.parts, errors);
  const contacts = readContacts(src.contacts, errors);

  if (src.result !== null) {
    errors.push(src.result === undefined
      ? 'study.result is required and must be null; results are not stored in the part script'
      : 'study.result must be null; results are not stored in the part script');
  }

  if (errors.length || !material) return { ok: false, errors, study: null };
  return {
    ok: true,
    errors: [],
    study: canonicalStudy({
      v: src.v,
      id: src.id,
      name: src.name,
      type: src.type,
      units: src.units,
      material,
      model: src.model,
      fixtures,
      loads,
      mesh: canonicalMesh(src.mesh),
      scope,
      parts,
      contacts,
      result: null,
    }),
  };
}

/** A valid study, with defaults filled in for anything omitted. */
export function defaultStudy(partial = {}) {
  const result = validateStudy(partial, { defaults: true });
  if (!result.ok) throw new StudyValidationError(result.errors);
  return result.study;
}

/** Stable one-line JSON for the part-script comment. */
export function studyJson(study) {
  const result = validateStudy(study, { defaults: false });
  if (!result.ok) throw new StudyValidationError(result.errors);
  return JSON.stringify(result.study);
}
