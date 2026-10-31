/**
 * Command protocol shared by the localhost agent relay and the server relay.
 *
 * This is the frame around one bridge call. It is not `window.surfcad.version`
 * (the in-page envelope) and not the `v` on prompt messages. Pairing and
 * prompt frames stay on their own `type` names in `relayMessages.mjs`.
 *
 * A frame we write always carries `v`. A frame we read may omit `v`; that
 * means version 1, so a peer from before this field still works on the
 * localhost relay. Any other `v` is not this protocol.
 *
 * The server relay's handshake is stricter: `checkAgentHandshakeVersion`
 * requires an explicit `v`. A missing or older `v` is too old for that
 * handshake. Local reads are unchanged.
 */

export const AGENT_PROTOCOL_VERSION = 1;

/**
 * @typedef {{ v: number, id: string | number, command: string, args: unknown }} CommandRequest
 * @typedef {{
 *   v: number,
 *   id: string | number,
 *   ok: true,
 *   result: unknown,
 * } | {
 *   v: number,
 *   id: string | number,
 *   ok: false,
 *   error?: unknown,
 * }} CommandResponse
 */

/**
 * @param {unknown} msg
 * @returns {boolean}
 */
export function isSupportedProtocolVersion(msg) {
  if (!msg || typeof msg !== 'object') return false;
  const version = /** @type {{ v?: unknown }} */ (msg).v;
  return version == null || version === AGENT_PROTOCOL_VERSION;
}

/**
 * @param {{ id?: string | number, command: string, args?: unknown }} fields
 * @returns {CommandRequest}
 */
export function commandRequest(fields) {
  return {
    v: AGENT_PROTOCOL_VERSION,
    id: fields.id,
    command: fields.command,
    args: fields.args == null ? {} : fields.args,
  };
}

/**
 * @param {{ id?: string | number, ok: boolean, result?: unknown, error?: unknown }} fields
 * @returns {CommandResponse}
 */
export function commandResponse(fields) {
  if (fields.ok === true) {
    return { v: AGENT_PROTOCOL_VERSION, id: fields.id, ok: true, result: fields.result };
  }
  const frame = { v: AGENT_PROTOCOL_VERSION, id: fields.id, ok: false };
  if (fields.error !== undefined) frame.error = fields.error;
  return frame;
}

/**
 * A command request: a string `command`, not a `pair` control frame, at a
 * supported protocol version. Args that are not an object become `{}`.
 * @param {unknown} msg
 * @returns {CommandRequest | null}
 */
export function readCommandRequest(msg) {
  if (!isSupportedProtocolVersion(msg)) return null;
  const frame = /** @type {{ type?: unknown, command?: unknown, id?: string | number, args?: unknown, v?: unknown }} */ (msg);
  if (frame.type === 'pair') return null;
  if (typeof frame.command !== 'string') return null;
  return {
    v: frame.v == null ? AGENT_PROTOCOL_VERSION : /** @type {number} */ (frame.v),
    id: frame.id,
    command: frame.command,
    args: frame.args && typeof frame.args === 'object' ? frame.args : {},
  };
}

/**
 * A command response: an own `ok` field, not a `pair` control frame, at a
 * supported protocol version. `ok` other than `true` is a failure.
 * @param {unknown} msg
 * @returns {CommandResponse | null}
 */
export function readCommandResponse(msg) {
  if (!isSupportedProtocolVersion(msg)) return null;
  const frame = /** @type {{ type?: unknown, ok?: unknown, id?: string | number, result?: unknown, error?: unknown, v?: unknown }} */ (msg);
  if (frame.type === 'pair') return null;
  if (!Object.prototype.hasOwnProperty.call(frame, 'ok')) return null;
  const version = frame.v == null ? AGENT_PROTOCOL_VERSION : /** @type {number} */ (frame.v);
  if (frame.ok === true) {
    return { v: version, id: frame.id, ok: true, result: frame.result };
  }
  const failure = { v: version, id: frame.id, ok: false };
  if (frame.error !== undefined) failure.error = frame.error;
  return failure;
}

/** Shown when a server-relay client speaks a protocol older than this one. */
export const AGENT_HANDSHAKE_UPDATE_MESSAGE = 'please update surfcad-mcp';

/**
 * Server handshake version. Unlike `readCommandRequest`, a missing `v` is
 * too old. `v` above {@link AGENT_PROTOCOL_VERSION} is a different protocol.
 * @param {unknown} version
 * @returns {{ ok: true, v: number } | { ok: false, error: string }}
 */
export function checkAgentHandshakeVersion(version) {
  if (typeof version !== 'number' || !Number.isFinite(version) || version < AGENT_PROTOCOL_VERSION) {
    return { ok: false, error: AGENT_HANDSHAKE_UPDATE_MESSAGE };
  }
  if (version !== AGENT_PROTOCOL_VERSION) {
    return { ok: false, error: `Unsupported protocol version: ${version}` };
  }
  return { ok: true, v: version };
}
