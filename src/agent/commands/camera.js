import { NO_ARGS_SCHEMA } from '../registry.js';

export const cameraCommand = Object.freeze({
  name: 'camera',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run(ctx) {
    const read = ctx.readCamera;
    const result = typeof read === 'function'
      ? read()
      : { position: null, quaternion: null, target: null, zoom: null, fov: null };
    return { result };
  },
});
