/**
 * What an Analyze tap is allowed to do.
 *
 * The viewport still hit-tests every solid. A hit on a mesh that is not in
 * the open study must not retarget the pick mesh: that swap is what handed
 * the face-highlight reconcile a missing faceID map, an undefined part, or
 * a parent that had just been removed. Setup and results ignore those
 * taps. Assembly setup is the exception, and only to add the part.
 */

import { studyScopeKind } from './studyPanel.js';

/** Part ids whose fixtures and loads this study is allowed to show. */
export function studyMemberIds(study, rows, analyzedPartId) {
  const kind = studyScopeKind(study);
  const analyzed = analyzedPartId != null && analyzedPartId !== '' ? String(analyzedPartId) : '';
  if (kind === 'assembly') {
    const ids = (rows || []).map((row) => String(row?.id || '')).filter(Boolean);
    return ids.length ? ids : (analyzed ? [analyzed] : []);
  }
  if (kind === 'parts') return (study?.scope?.ids || []).map((id) => String(id)).filter(Boolean);
  return analyzed ? [analyzed] : [];
}

/**
 * `ignore` drops the tap. `add-part` includes a row that is not in the
 * study yet. `pick` is a face on a member.
 */
export function feaTapAction({ screen, scopeKind, memberIds, hitPartId } = {}) {
  if (hitPartId == null || hitPartId === '') return 'ignore';
  const id = String(hitPartId);
  const members = (memberIds || []).map(String);
  if (members.includes(id)) return 'pick';
  const assemblySetup = (screen == null || screen === 'setup')
    && (scopeKind === 'assembly' || scopeKind === 'parts');
  if (assemblySetup) return 'add-part';
  return 'ignore';
}

/**
 * A stamped face belongs to its part. A part-scope face (no id) belongs
 * to the analyzed part, and only while that part is in the study.
 */
export function faceBelongsToStudy(face, memberIds, analyzedPartId) {
  const members = (memberIds || []).map(String);
  const part = face?.part != null && face.part !== '' ? String(face.part) : '';
  if (part) return members.includes(part);
  if (!members.length) return true;
  const analyzed = analyzedPartId != null && analyzedPartId !== '' ? String(analyzedPartId) : '';
  return analyzed ? members.includes(analyzed) : false;
}

/** A fixture or load row is shown when one of its faces belongs. */
export function entryVisible(entry, memberIds, analyzedPartId) {
  const faces = entry?.faces || [];
  if (!faces.length) return faceBelongsToStudy(null, memberIds, analyzedPartId);
  return faces.some((face) => faceBelongsToStudy(face, memberIds, analyzedPartId));
}
