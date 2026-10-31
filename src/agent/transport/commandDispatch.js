/**
 * Command dispatch. Turns a protocol command frame into `call` and sends the
 * protocol response. The transport is only `onMessage` and a send function.
 */

import {
  AGENT_PROTOCOL_VERSION,
  commandResponse,
  readCommandRequest,
} from '../../../packages/surfcad-mcp/src/commandProtocol.mjs';

/**
 * @param {import('../../../packages/surfcad-mcp/src/commandProtocol.mjs').CommandRequest} request
 * @param {{
 *   call: (command: string, args: Record<string, unknown>) => Promise<{ ok?: boolean, result?: unknown, error?: { code?: string, message?: string } }>,
 *   send: (message: object) => void,
 *   onActivity?: (activity: { hold: boolean }) => void,
 * }} opts
 */
export function dispatchCommand(request, opts) {
  const { call, send, onActivity } = opts;
  onActivity?.({ hold: true });
  return run();

  async function run() {
    try {
      const env = await call(request.command, /** @type {Record<string, unknown>} */ (request.args));
      if (env?.ok) {
        send(commandResponse({ id: request.id, ok: true, result: env.result }));
      } else {
        send(commandResponse({
          id: request.id,
          ok: false,
          error: env?.error || { code: 'refused', message: 'Command refused' },
        }));
      }
    } catch (err) {
      send(commandResponse({
        id: request.id,
        ok: false,
        error: { code: 'internal', message: String(err?.message || err) },
      }));
    } finally {
      onActivity?.({ hold: false });
    }
  }
}

/**
 * Subscribe to command frames on a transport. Other frames are ignored.
 * When the transport has `captureSend`, the reply stays on the connection
 * that received the command.
 *
 * @param {{
 *   onMessage: (handler: (message: object) => void) => () => void,
 *   send: (message: object) => void,
 *   captureSend?: () => (message: object) => void,
 * }} transport
 * @param {{
 *   call: (command: string, args: Record<string, unknown>) => Promise<{ ok?: boolean, result?: unknown, error?: { code?: string, message?: string } }>,
 *   onActivity?: (activity: { hold: boolean }) => void,
 * }} opts
 */
export function attachCommandDispatch(transport, opts) {
  return transport.onMessage((message) => {
    if (!message || typeof message !== 'object') return;
    const frame = /** @type {{ command?: unknown, v?: unknown, id?: string | number }} */ (message);
    const send = typeof transport.captureSend === 'function'
      ? transport.captureSend()
      : (payload) => transport.send(payload);
    if (typeof frame.command === 'string' && frame.v != null && frame.v !== AGENT_PROTOCOL_VERSION) {
      send(commandResponse({
        id: frame.id,
        ok: false,
        error: { code: 'bad_call', message: `Unsupported protocol version: ${frame.v}` },
      }));
      return;
    }
    const request = readCommandRequest(message);
    if (!request) return;
    void dispatchCommand(request, { call: opts.call, send, onActivity: opts.onActivity });
  });
}
