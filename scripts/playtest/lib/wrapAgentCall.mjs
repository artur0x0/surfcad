/**
 * Host set_script requires part_id. Goldens/playtests that still pass only
 * { source } get the active id from parts.
 */
export function wrapAgentCall(rawCall, pickResult = (env) => env?.result) {
  return async function agentCall(page, name, args) {
    let payload = args ?? {};
    if (name === 'set_script' && payload.part_id == null && typeof payload.source === 'string') {
      const listed = await rawCall(page, 'parts', {});
      const partId = pickResult(listed)?.activeId;
      if (partId) payload = { ...payload, part_id: partId };
    }
    return rawCall(page, name, payload);
  };
}
