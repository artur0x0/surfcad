export const JOINT_TYPES = Object.freeze([
  'coincident',
  'parallel',
  'perpendicular',
  'distance',
  'angle',
  'concentric',
  'symmetric',
  'fixed',
]);

const JOINT_TYPE_SET = new Set(JOINT_TYPES);

export function jointTypesMessage() {
  return JOINT_TYPES.join(', ');
}

export function normalizeJointType(type) {
  const raw = String(type);
  if (raw === 'planar') return 'coincident';
  return raw;
}

export function jointParamsFromArgs(args) {
  const patch = {};
  if (args?.type != null) {
    const type = normalizeJointType(args.type);
    if (!JOINT_TYPE_SET.has(type)) {
      return {
        error: {
          code: 'bad_args',
          message: `Unknown joint type: ${args.type}. Valid types: ${jointTypesMessage()} (planar is an alias for coincident)`,
        },
      };
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
