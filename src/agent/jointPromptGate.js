/**
 * Whether `joint_open` (and therefore `joint_create` and the pick / edit
 * calls that follow it) may start a joint session.
 *
 * The feature-popup gate keeps modeling cards off the viewport while an
 * in-viewer prompt is responding or building. Joints are the exception:
 * building is when the agent creates them, and responding is the same
 * pending run. Game mode and another feature session still refuse.
 *
 * @param {{ game?: boolean, featureSession?: boolean }} [opts]
 * @returns {boolean}
 */
export function beginAgentJointSession(opts = {}) {
  if (opts.game === true || opts.featureSession === true) return false;
  return true;
}
