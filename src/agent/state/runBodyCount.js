/**
 * Body count on an agent run outcome.
 * Null means this part has not been run. A finished run with no bodies is 0.
 * `meshCount` is the mesh fallback `status` already uses when the cached
 * run did not store a number.
 */
import { geometryFromExecuteResult } from '../../utils/assembly.js';

export function finishedRunBodyCount(run, meshCount = null) {
  if (run?.empty) return 0;
  if (!(run?.ok === true && run?.mesh?.vertProperties)) return null;
  const fromGeom = geometryFromExecuteResult(run).bodyCount;
  const bodyCount = fromGeom != null ? fromGeom : meshCount;
  return Number.isFinite(bodyCount) ? bodyCount : null;
}
