/**
 * Injection point for the in-viewer agent prompt transport.
 *
 * PR 1: the stub is DEV / test only. Production builds return null so the
 * UI never echoes a fake reply. PR 2 (MCP Lead): swap the DEV branch to
 * `createAgentPromptTransport` from `./agentPromptTransport.js`.
 * Do not create or edit `agentPromptTransport.js` in this PR.
 */
import { createAgentPromptStub } from './agentPromptStub.js';

function readImportMetaEnv() {
  try {
    return import.meta.env;
  } catch {
    return undefined;
  }
}

/**
 * The echo stub must never ship to a production bundle.
 * `env.DEV === true` is Vite's development flag. Tests pass `{ DEV: true }`
 * when they need the stub, or `{ DEV: false }` to prove the prod gate.
 */
export function agentPromptStubAllowed(env = readImportMetaEnv()) {
  return env?.DEV === true;
}

export function createAgentPrompt(options = {}, env = readImportMetaEnv()) {
  if (!agentPromptStubAllowed(env)) return null;
  return createAgentPromptStub(options);
}
