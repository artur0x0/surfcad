import { NO_ARGS_SCHEMA } from '../registry.js';
import { buildSelection } from '../state/selection.js';

export const selectionCommand = Object.freeze({
  name: 'selection',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const read = ctx.readSelection;
    if (typeof read !== 'function') {
      return { result: buildSelection({}) };
    }
    const raw = read();
    return {
      result: buildSelection({
        activePartId: raw.activePartId,
        cadPartId: raw.cadPartId,
        cadPartHighlighted: raw.cadPartHighlighted,
        face: raw.face,
        edges: raw.edges,
        armedContourId: raw.contour?.armedId,
        selectedPlaneId: raw.contour?.planeId,
      }),
    };
  },
});
