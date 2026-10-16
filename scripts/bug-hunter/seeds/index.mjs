import * as centered from './regression-blocks-centered.mjs';
import * as pose from './regression-blocks-pose.mjs';
import * as overlap from './regression-blocks-overlap-move.mjs';
import * as zeroBlur from './regression-number-zero-blur.mjs';

/** Fixed regressions replayed before any LLM exploration (PR #484–#486 era). */
export const regressionSeeds = [centered, pose, overlap, zeroBlur];

export function getSeed(id) {
  return regressionSeeds.find((row) => row.id === id) || null;
}
