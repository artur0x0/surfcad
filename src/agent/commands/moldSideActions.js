/**
 * Alias of mold_parting for side actions. `on: true` or an omitted `on`
 * opens the core / cavity colouring and returns the same slide and lifter
 * counts. `on: false` does not hide that colouring; the result names
 * mold_parting.
 */

const SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    on: {
      type: 'boolean',
      description: 'true, or omit, opens core and cavity and returns the side actions. false does not hide them. Call mold_parting { on: false } to hide that colouring.',
    },
    group: {
      type: ['integer', 'null'],
      description: 'Side-action group id to highlight, forwarded to mold_parting.',
    },
  },
});

const REPLACED = 'Side actions are part of core and cavity. Call mold_parting with { on: false } to hide that colouring.';

export const moldSideActionsCommand = Object.freeze({
  name: 'mold_side_actions',
  uiEntry: 'data-mold-parting',
  schema: SCHEMA,
  example: { on: true },
  immediate: true,
  run(ctx, args) {
    if (args?.on === false) {
      return {
        result: {
          on: false,
          replacedBy: 'mold_parting',
          message: REPLACED,
        },
      };
    }
    const show = ctx.moldParting;
    if (typeof show !== 'function') {
      return {
        error: {
          code: 'internal',
          message: 'Side actions are part of mold_parting. The moldParting handler is missing.',
        },
      };
    }
    const out = show({ on: true, group: args?.group });
    const pack = (value) => {
      if (value?.error) return { error: value.error };
      const sides = value?.sideActions;
      return {
        result: {
          on: true,
          replacedBy: 'mold_parting',
          count: sides?.count ?? 0,
          slides: sides?.slides ?? 0,
          lifters: sides?.lifters ?? 0,
          groups: sides?.groups ?? [],
          selected: sides?.selected ?? null,
        },
      };
    };
    if (out && typeof out.then === 'function') return out.then(pack);
    return pack(out);
  },
});
