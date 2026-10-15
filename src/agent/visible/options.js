/** Default pacing for operator-visible agent mode (ms between cue and command). */
export const DEFAULT_VISIBLE_STEP_DELAY_MS = 400;

export const DEFAULT_AGENT_VISIBLE_OPTIONS = Object.freeze({
  enabled: false,
  stepDelayMs: DEFAULT_VISIBLE_STEP_DELAY_MS,
  cursor: true,
  highlight: true,
  ripple: true,
  /** Ease camera_set position/target/fov when the viewport supports it. */
  easeCamera: true,
});

/**
 * @param {Partial<typeof DEFAULT_AGENT_VISIBLE_OPTIONS> | null | undefined} patch
 * @param {typeof DEFAULT_AGENT_VISIBLE_OPTIONS} base
 */
export function mergeAgentVisibleOptions(patch, base = DEFAULT_AGENT_VISIBLE_OPTIONS) {
  const next = { ...base };
  if (!patch || typeof patch !== 'object') return next;
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (Number.isFinite(Number(patch.stepDelayMs)) && Number(patch.stepDelayMs) >= 0) {
    next.stepDelayMs = Math.round(Number(patch.stepDelayMs));
  }
  if (typeof patch.cursor === 'boolean') next.cursor = patch.cursor;
  if (typeof patch.highlight === 'boolean') next.highlight = patch.highlight;
  if (typeof patch.ripple === 'boolean') next.ripple = patch.ripple;
  if (typeof patch.easeCamera === 'boolean') next.easeCamera = patch.easeCamera;
  return next;
}
