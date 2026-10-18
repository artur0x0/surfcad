/**
 * Rewrite FEA study part ids after working-copy identity collapse.
 *
 * Studies live as `// @fea-study {json}` inside part scripts. face.part,
 * contact a.part/b.part, scope.ids, and study.parts[].id store the clicked
 * row id. Collapse remaps UUID / path-as-id rows; this walks only those
 * known fields and rewrites exact map hits. Never a blind string replace.
 *
 * Shape is src/fea/studySchema.js. This module does not import src/fea.
 */

export const FEA_STUDY_BEGIN = '// --- fea-study begin ---';
export const FEA_STUDY_END = '// --- fea-study end ---';
const STUDY_TAG = '// @fea-study ';

function remapExact(id, map) {
  if (typeof id !== 'string' || !id || !map?.has(id)) return id;
  return map.get(id);
}

function rewriteFace(face, map) {
  if (!face || typeof face !== 'object' || Array.isArray(face)) return { face, changed: false };
  if (!Object.prototype.hasOwnProperty.call(face, 'part')) return { face, changed: false };
  const next = remapExact(face.part, map);
  if (next === face.part) return { face, changed: false };
  return { face: { ...face, part: next }, changed: true };
}

function rewriteFaceLists(items, map) {
  if (!Array.isArray(items)) return { items, changed: false };
  let changed = false;
  const nextItems = items.map((item) => {
    if (!item || typeof item !== 'object' || !Array.isArray(item.faces)) return item;
    let facesChanged = false;
    const faces = item.faces.map((face) => {
      const out = rewriteFace(face, map);
      if (out.changed) facesChanged = true;
      return out.face;
    });
    if (!facesChanged) return item;
    changed = true;
    return { ...item, faces };
  });
  return { items: changed ? nextItems : items, changed };
}

function rewriteContactEnd(end, map) {
  if (!end || typeof end !== 'object' || Array.isArray(end)) return { end, changed: false };
  if (!Object.prototype.hasOwnProperty.call(end, 'part')) return { end, changed: false };
  const next = remapExact(end.part, map);
  if (next === end.part) return { end, changed: false };
  return { end: { ...end, part: next }, changed: true };
}

/**
 * Mutate a parsed study object: fixtures/loads faces, contacts, scope.ids,
 * and parts[].id (per-body material rows). Returns whether anything changed.
 */
export function rewriteFeaStudyObject(study, map) {
  if (!study || typeof study !== 'object' || Array.isArray(study) || !map?.size) return false;
  let changed = false;

  const fixtures = rewriteFaceLists(study.fixtures, map);
  if (fixtures.changed) {
    study.fixtures = fixtures.items;
    changed = true;
  }
  const loads = rewriteFaceLists(study.loads, map);
  if (loads.changed) {
    study.loads = loads.items;
    changed = true;
  }

  if (Array.isArray(study.contacts)) {
    let contactsChanged = false;
    const contacts = study.contacts.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const a = rewriteContactEnd(row.a, map);
      const b = rewriteContactEnd(row.b, map);
      if (!a.changed && !b.changed) return row;
      contactsChanged = true;
      return { ...row, a: a.end, b: b.end };
    });
    if (contactsChanged) {
      study.contacts = contacts;
      changed = true;
    }
  }

  if (study.scope && typeof study.scope === 'object' && Array.isArray(study.scope.ids)) {
    const ids = study.scope.ids.map((id) => remapExact(id, map));
    if (ids.some((id, i) => id !== study.scope.ids[i])) {
      study.scope = { ...study.scope, ids };
      changed = true;
    }
  }

  if (Array.isArray(study.parts)) {
    let partsChanged = false;
    const parts = study.parts.map((entry) => {
      if (!entry || typeof entry !== 'object' || !Object.prototype.hasOwnProperty.call(entry, 'id')) {
        return entry;
      }
      const next = remapExact(entry.id, map);
      if (next === entry.id) return entry;
      partsChanged = true;
      return { ...entry, id: next };
    });
    if (partsChanged) {
      study.parts = parts;
      changed = true;
    }
  }

  return changed;
}

function closedSpans(script) {
  const spans = [];
  let from = 0;
  while (from < script.length) {
    const start = script.indexOf(FEA_STUDY_BEGIN, from);
    if (start < 0) break;
    const endMarker = script.indexOf(FEA_STUDY_END, start + FEA_STUDY_BEGIN.length);
    if (endMarker < 0) break;
    let end = endMarker + FEA_STUDY_END.length;
    if (script[end] === '\r') end += 1;
    if (script[end] === '\n') end += 1;
    spans.push({ start, end });
    from = end;
  }
  return spans;
}

function rewriteTaggedLine(line, map) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed.startsWith(STUDY_TAG)) return { line, changed: false };
  const json = trimmed.slice(STUDY_TAG.length).trim();
  if (!json) return { line, changed: false };
  let study;
  try {
    study = JSON.parse(json);
  } catch {
    return { line, changed: false };
  }
  if (!rewriteFeaStudyObject(study, map)) return { line, changed: false };
  const ending = line.endsWith('\r') ? '\r' : '';
  return { line: `${STUDY_TAG}${JSON.stringify(study)}${ending}`, changed: true };
}

/**
 * Rewrite known study id fields in `script`. Unrelated source is unchanged.
 * Invalid JSON blocks are left in place.
 */
export function rewriteFeaStudyPartIds(script, map) {
  if (typeof script !== 'string' || !script || !map?.size) return script;
  if (!script.includes(STUDY_TAG.trim())) return script;
  const spans = closedSpans(script);
  if (!spans.length) return script;
  let out = script;
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const span = spans[i];
    const block = out.slice(span.start, span.end);
    const lines = block.split('\n');
    let changed = false;
    const nextLines = lines.map((line) => {
      const rewritten = rewriteTaggedLine(line, map);
      if (rewritten.changed) changed = true;
      return rewritten.line;
    });
    if (!changed) continue;
    out = out.slice(0, span.start) + nextLines.join('\n') + out.slice(span.end);
  }
  return out;
}
