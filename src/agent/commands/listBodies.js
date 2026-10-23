import { NO_ARGS_SCHEMA } from '../registry.js';

/**
 * Bodies of the active part's last run, in mesh order, each with the
 * centroid `move()` and `rotateAbout()` name as `{ at }`. `index` is what
 * insert_move and insert_rotate take as `body_index`; `at` is what they take as `at`. Immediate read; empty before
 * the first run.
 */
export const listBodiesCommand = Object.freeze({
  name: 'list_bodies',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const read = ctx.readBodies;
    const out = typeof read === 'function' ? read() : null;
    const bodies = Array.isArray(out?.bodies) ? out.bodies : [];
    return {
      result: {
        partId: out?.partId ?? null,
        bodies: bodies.map((body, index) => ({
          index: Number.isInteger(body?.index) ? body.index : index,
          at: Array.isArray(body?.at) ? body.at.slice(0, 3).map(Number) : [0, 0, 0],
          triangleCount: Number.isFinite(body?.triangleCount) ? body.triangleCount : 0,
        })),
      },
    };
  },
});
