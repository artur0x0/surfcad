/**
 * Shared classes for the Connect Agent primary button (light + dark chrome).
 * surface-success + text-on-dark: ≥4.5:1 rest, ≥3:1 hover (emerald-500 hover was ~2.5:1).
 */

export const CONNECT_AGENT_BUTTON_CLASS = [
  'w-full rounded-md px-3 py-2 text-ui-sm font-semibold text-on-dark font-ui',
  'surface-success',
  'disabled:opacity-50 disabled:cursor-not-allowed',
].join(' ');
