import { NO_ARGS_SCHEMA } from '../registry.js';
import { gitTimings } from '../../utils/git/gitTimings.js';

/**
 * The last git operation's call count and timing (B17 PR 1): how many
 * adapter calls and HTTP round trips Open or Save made, per method and per
 * endpoint. Immediate read; it never touches the vault.
 */
export const gitTimingsCommand = Object.freeze({
  name: 'git_timings',
  schema: NO_ARGS_SCHEMA,
  example: {},
  immediate: true,
  run() {
    return { result: gitTimings.snapshot() };
  },
});
