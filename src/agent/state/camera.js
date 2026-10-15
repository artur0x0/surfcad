function vec3(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const out = [Number(value[0]), Number(value[1]), Number(value[2])];
    return out.every((n) => Number.isFinite(n)) ? out : null;
  }
  const out = [Number(value.x), Number(value.y), Number(value.z)];
  return out.every((n) => Number.isFinite(n)) ? out : null;
}

function quat(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const out = [Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3])];
    return out.every((n) => Number.isFinite(n)) ? out : null;
  }
  const out = [Number(value.x), Number(value.y), Number(value.z), Number(value.w)];
  return out.every((n) => Number.isFinite(n)) ? out : null;
}

/**
 * @param {{
 *   position?: object | number[] | null,
 *   quaternion?: object | number[] | null,
 *   target?: object | number[] | null,
 *   zoom?: number,
 *   fov?: number,
 * }} input
 */
export function buildCameraState(input = {}) {
  const position = vec3(input.position);
  const quaternion = quat(input.quaternion);
  const target = vec3(input.target);
  const zoom = Number(input.zoom);
  const fov = Number(input.fov);
  return {
    position,
    quaternion,
    target,
    zoom: Number.isFinite(zoom) ? zoom : null,
    fov: Number.isFinite(fov) ? fov : null,
  };
}
