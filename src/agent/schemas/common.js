/** Shared JSON Schema fragments for agent bridge commands (strict, MCP-facing). */

export const NO_ARGS_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {},
});

export const FACE_KEY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['at', 'n', 'area'],
  properties: {
    at: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    n: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    area: { type: 'number' },
    src: { type: 'integer' },
    ord: { type: 'integer' },
  },
});

export const EDGE_KEY_SCHEMA = Object.freeze({
  oneOf: [
    { type: 'string', description: 'Grouped boundary id (eN) or packed mesh edge key' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['faceKeyA', 'faceKeyB'],
      properties: {
        faceKeyA: FACE_KEY_SCHEMA,
        faceKeyB: FACE_KEY_SCHEMA,
        faceA: FACE_KEY_SCHEMA,
        faceB: FACE_KEY_SCHEMA,
        faceKeys: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: FACE_KEY_SCHEMA,
        },
      },
    },
  ],
});

export const EDGE_FACE_PAIR_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['faceKeyA', 'faceKeyB'],
  properties: {
    faceKeyA: FACE_KEY_SCHEMA,
    faceKeyB: FACE_KEY_SCHEMA,
    faceA: FACE_KEY_SCHEMA,
    faceB: FACE_KEY_SCHEMA,
    faceKeys: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: FACE_KEY_SCHEMA,
    },
  },
});

/** A sketch entity for pick kinds point, line, arc, ref: `{ id }` or, for a hole centre, `{ at: [u, v] }`. */
export const SKETCH_PICK_KEY_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'Sketch entity id from list_sketch_entities' },
    at: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Hole centre [u, v] on the sketch plane' },
  },
});

/**
 * One pick key in any accepted form. `anyOf`, not `oneOf`: a plain string is
 * both a face/edge id and a sketch id, and strict clients reject a value that
 * matches two `oneOf` branches.
 */
export const PICK_KEY_SCHEMA = Object.freeze({
  anyOf: [
    { type: 'string', description: 'Face id (fN), grouped edge id (eN), packed mesh edge key, or sketch entity id' },
    FACE_KEY_SCHEMA,
    EDGE_FACE_PAIR_SCHEMA,
    SKETCH_PICK_KEY_SCHEMA,
  ],
});

export const SKETCH_PICK_ITEM_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['point', 'line', 'arc', 'ref'] },
    id: { type: 'string' },
  },
});

export const SKETCH_PICKS_SCHEMA = Object.freeze({
  type: 'array',
  items: SKETCH_PICK_ITEM_SCHEMA,
});

export const BBOX_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    min: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    max: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
  },
});

export const STATUS_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    partId: { type: 'string' },
    partName: { type: 'string' },
    script: { type: 'string' },
    runState: { type: 'string', enum: ['not_run_yet', 'ok', 'failed'] },
    volume: { type: ['number', 'null'] },
    bbox: { oneOf: [BBOX_SCHEMA, { type: 'null' }] },
    featureCount: { type: 'integer' },
    bodyCount: { type: ['integer', 'null'] },
    stale: { type: 'boolean' },
    featureMs: {
      type: 'object',
      description: 'Kernel milliseconds per feature block (by feature_tree id) on the last run that reported; what is expensive on this part',
      additionalProperties: { type: 'number' },
    },
    cache: {
      type: 'object',
      description: 'Feature memoisation on the last run: blocks = marked blocks, hits = blocks restored from the worker cache instead of re-run, misses = blocks that ran, bytes = the cache size. An edit re-runs only the edited block and the ones after it.',
      additionalProperties: false,
      properties: {
        blocks: { type: 'integer' },
        hits: { type: 'integer' },
        misses: { type: 'integer' },
        bytes: { type: 'integer' },
      },
    },
    featureCached: {
      type: 'object',
      description: 'Feature blocks (by feature_tree id) served from the cache on the last run: true per id',
      additionalProperties: { type: 'boolean' },
    },
    lastGood: {
      type: 'object',
      description: 'Only while runState is failed: volume, bbox and bodyCount of this part\'s last successful run (the solid the viewport still shows), so a failing feature does not blank the numbers',
      additionalProperties: false,
      properties: {
        volume: { type: ['number', 'null'] },
        bbox: { oneOf: [BBOX_SCHEMA, { type: 'null' }] },
        bodyCount: { type: ['integer', 'null'] },
      },
    },
    features: {
      type: 'array',
      description: 'Feature strip rows, only with return: "summary" (script is omitted with "status" and "summary")',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          kind: { type: 'string' },
          label: { type: 'string' },
          chipLabel: { type: 'string' },
          index: { type: 'integer' },
          ms: { type: 'number', description: 'Kernel milliseconds of this block on the last run that reported it' },
          cached: { type: 'boolean', description: 'True when the last run restored this block from the feature cache instead of running it' },
        },
      },
    },
  },
});

/** Present on a mutate result when the geometry engine crashed under the part. */
export const CRASH_RECORD_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: true,
  properties: {
    code: { const: 'geometry_worker_crashed' },
    reason: { type: 'string', enum: ['wasm_abort', 'out_of_memory', 'timeout', 'worker_lost'] },
    workerRestarted: { type: 'boolean' },
    message: { type: 'string' },
    wasmHeapMB: { type: 'number' },
    budgetMs: { type: 'number' },
    partId: { type: 'string' },
    featureId: { type: 'string' },
  },
});

export const MUTATE_RESULT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
    errors: { type: 'array', items: { type: 'string' } },
    status: STATUS_SCHEMA,
    unchanged: { type: 'boolean' },
    crash: CRASH_RECORD_SCHEMA,
  },
});

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

export const CAMERA_VIEW_ENUM = Object.freeze([
  'iso', 'front', 'right', 'top', 'back', 'left', 'bottom',
]);
