import { parseFeatureMarkers } from '../../utils/featureMarkers.js';

const RANGE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  description: 'Read one span of feature blocks instead of the whole script. Ids are feature_tree ids. fromFeature alone reads that one block; toFeature alone reads from the first block to it.',
  properties: {
    fromFeature: { type: 'string', description: 'First feature block of the span (feature_tree id)' },
    toFeature: { type: 'string', description: 'Last feature block of the span (feature_tree id)' },
  },
});

/**
 * The span of `script` from the start of `fromFeature` to the end of
 * `toFeature`. `{ error }` names an unknown id or a reversed span.
 */
export function sliceScriptRange(script, range) {
  const text = typeof script === 'string' ? script : '';
  const from = typeof range?.fromFeature === 'string' ? range.fromFeature : null;
  const to = typeof range?.toFeature === 'string' ? range.toFeature : null;
  const blocks = parseFeatureMarkers(text);
  if (!blocks.length) {
    return { error: { code: 'unknown_feature', message: 'The script has no feature blocks; read it without range' } };
  }
  const find = (id) => blocks.find((row) => row.id === id) || null;
  const first = from ? find(from) : blocks[0];
  if (!first) return { error: { code: 'unknown_feature', message: `No feature ${from}; ids come from feature_tree` } };
  const last = to ? find(to) : (from ? first : blocks[blocks.length - 1]);
  if (!last) return { error: { code: 'unknown_feature', message: `No feature ${to}; ids come from feature_tree` } };
  if (last.index < first.index) {
    return { error: { code: 'bad_args', message: `range runs backwards: ${last.id} comes before ${first.id}` } };
  }
  return {
    source: text.slice(first.startOffset, last.endOffset),
    range: {
      fromFeature: first.id,
      toFeature: last.id,
      startOffset: first.startOffset,
      endOffset: last.endOffset,
      features: last.index - first.index + 1,
    },
  };
}

/** Editor buffer, or one span of its feature blocks. Resolves immediately, ahead of a queued mutation. */
export const getScriptCommand = Object.freeze({
  name: 'get_script',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: { range: RANGE_SCHEMA },
  }),
  example: {},
  immediate: true,
  checkArgs(args) {
    const range = args?.range;
    if (range == null) return null;
    if (typeof range !== 'object' || Array.isArray(range)) {
      return { code: 'bad_args', message: 'get_script range must be { fromFeature?, toFeature? }' };
    }
    for (const key of ['fromFeature', 'toFeature']) {
      if (range[key] != null && typeof range[key] !== 'string') {
        return { code: 'bad_args', message: `get_script range.${key} must be a feature id string` };
      }
    }
    return null;
  },
  run(ctx, args) {
    const text = ctx.getScript();
    const source = typeof text === 'string' ? text : '';
    if (args?.range == null) return { result: { source } };
    const sliced = sliceScriptRange(source, args.range);
    if (sliced.error) return { error: sliced.error };
    return { result: sliced };
  },
});
