const JOINT_TYPES = new Set([
  'coincident',
  'parallel',
  'perpendicular',
  'distance',
  'angle',
  'concentric',
  'symmetric',
  'fixed',
]);

export function jointParamsFromArgs(args) {
  const patch = {};
  if (args?.type != null) {
    const type = String(args.type);
    if (!JOINT_TYPES.has(type)) {
      return { error: { code: 'bad_args', message: `Unknown joint type: ${type}` } };
    }
    patch.type = type;
    patch.userPickedType = true;
  }
  if (args?.name != null) {
    patch.name = String(args.name);
    patch.userNamed = true;
  }
  if (args?.value_mm != null || args?.value != null) {
    const value = Number(args.value_mm ?? args.value);
    if (!Number.isFinite(value)) {
      return { error: { code: 'bad_args', message: 'joint value must be a finite number' } };
    }
    patch.valueMm = value;
  }
  if (args?.sense != null) {
    patch.sense = args.sense === -1 ? -1 : 1;
  }
  if (args?.opposed != null) {
    patch.opposed = args.opposed !== false;
  }
  return { patch };
}
