/**
 * Shared host ref for the agent registry.
 *
 * App and Viewport each publish the handlers they already call. A later
 * publish merges by key, so one side does not drop the other's handlers.
 * Call this during render, the same way App already keeps `agentHostRef`
 * current. Do not replace `ref.current` with a fresh object.
 */

export function fillAgentHost(ref, handlers) {
  if (!ref || handlers == null || typeof handlers !== 'object') return;
  const prev = ref.current && typeof ref.current === 'object' ? ref.current : {};
  ref.current = { ...prev, ...handlers };
}
