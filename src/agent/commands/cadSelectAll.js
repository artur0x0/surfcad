import { NO_ARGS_SCHEMA } from '../schemas/common.js';

export const cadSelectAllCommand = Object.freeze({
  name: 'cad_select_all',
  uiEntry: 'data-cad-select-all',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const fn = ctx.cadSelectAll;
    if (typeof fn !== 'function') {
      return { error: { code: 'internal', message: 'cadSelectAll handler is missing' } };
    }
    const out = fn();
    if (out?.error) return { error: out.error };
    return { result: out?.result ?? out ?? { ok: true } };
  },
});
