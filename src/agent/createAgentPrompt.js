/**
 * DEV-only echo stub for the in-viewer agent prompt.
 *
 * Paired sessions use `createLiveAgentPromptTransport()` (real
 * `createAgentPromptTransport(bridge)`). This stub is for DEV with no
 * pairing and for `?agentPromptDemo=1`. Production with no paired agent
 * returns null and never echoes.
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
