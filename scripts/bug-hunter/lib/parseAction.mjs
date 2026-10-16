/**
 * Parse explorer model output into a bridge command or stop signal.
 */

export function parseExplorerAction(message) {
  if (!message || typeof message !== 'object') {
    return { ok: false, error: 'model response was not an object' };
  }
  if (message.stop === true || message.action === 'stop') {
    return { ok: true, stop: true, reason: String(message.reason || message.rationale || 'stop') };
  }
  const command = message.command || message.call || message.name;
  if (!command || typeof command !== 'string') {
    return { ok: false, error: 'missing command field' };
  }
  const args = message.args && typeof message.args === 'object' && !Array.isArray(message.args)
    ? message.args
    : {};
  return {
    ok: true,
    stop: false,
    command: command.trim(),
    args,
    rationale: String(message.rationale || message.reason || ''),
  };
}
