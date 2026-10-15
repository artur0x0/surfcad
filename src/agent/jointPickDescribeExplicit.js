function vec3(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const out = [Number(value[0]), Number(value[1]), Number(value[2])];
  return out.every((n) => Number.isFinite(n)) ? out : null;
}

export function describeJointPickFromExplicit({ key, kind }) {
  const at = vec3(key?.at);
  const dir = vec3(key?.dir);
  const radius = Number(key?.radius);
  const length = Number(key?.length);
  const hasAxisKey = dir && Number.isFinite(radius) && radius > 0 && !Number.isFinite(length);
  if (kind === 'axis' || hasAxisKey) {
    if (!at || !dir) {
      return { error: { code: 'bad_args', message: 'Axis key needs at, dir, and radius' } };
    }
    if (!(radius > 0)) {
      return { error: { code: 'bad_args', message: 'Axis key needs a positive radius' } };
    }
    return {
      kind: 'axis',
      planar: false,
      axis: true,
      key: { at, dir, radius },
    };
  }
  if (kind === 'edge' || (dir && Number.isFinite(length))) {
    if (!at || !dir) {
      return { error: { code: 'bad_args', message: 'Edge key needs at and dir' } };
    }
    return {
      kind: 'edge',
      planar: false,
      axis: Number.isFinite(radius) && radius > 0,
      key: { ...key, at, dir },
    };
  }
  return null;
}
