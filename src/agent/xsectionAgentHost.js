import { PLANE_PRESETS } from '../utils/crossSection.js';

const PRESET_IDS = Object.freeze(Object.keys(PLANE_PRESETS));
const SETTLE_MS = 400;
const POLL_MS = 40;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createXsectionAgentHandlers(deps) {
  const sleepMs = deps.sleep ?? sleep;
  const settleMs = deps.settleMs ?? SETTLE_MS;
  const pollMs = deps.pollMs ?? POLL_MS;

  function requirePanel() {
    const panel = deps.panelRef?.current;
    if (!panel?.readAgentState) {
      return { error: { code: 'internal', message: 'Cross-section panel is not mounted' } };
    }
    return { panel };
  }

  function requireMesh() {
    const mesh = deps.getMesh?.();
    if (!mesh?.geometry) {
      return { error: { code: 'no_mesh', message: 'No mesh for cross-section' } };
    }
    return { mesh };
  }

  function isEnabled() {
    return !!deps.enabledRef?.current;
  }

  async function waitForState(match, { timeoutMs = settleMs } = {}) {
    const attempts = Math.ceil(timeoutMs / pollMs);
    for (let i = 0; i < attempts; i += 1) {
      const panel = deps.panelRef?.current;
      const state = panel?.readAgentState?.();
      if (state && match(state)) return state;
      await sleepMs(pollMs);
    }
    const panel = deps.panelRef?.current;
    const state = panel?.readAgentState?.();
    if (state && match(state)) return state;
    return null;
  }

  return {
    async crossSectionToggle({ enabled } = {}) {
      const meshGate = requireMesh();
      if (meshGate.error) return meshGate;
      const panelGate = requirePanel();
      if (panelGate.error) return panelGate;
      const { panel } = panelGate;
      const was = isEnabled();
      const target = typeof enabled === 'boolean' ? enabled : !was;
      if (target === was) {
        return { result: panel.readAgentState() };
      }
      panel.agentSetEnabled(target);
      if (target) {
        deps.enabledRef.current = true;
      } else {
        deps.enabledRef.current = false;
      }
      const wantOptionsOpen = target;
      const state = await waitForState(
        (row) => row.enabled === target && row.optionsOpen === wantOptionsOpen,
      );
      if (!state) {
        return { error: { code: 'internal', message: 'Cross-section toggle did not settle' } };
      }
      return { result: state };
    },

    async crossSectionExpand({ open } = {}) {
      const panelGate = requirePanel();
      if (panelGate.error) return panelGate;
      const { panel } = panelGate;
      if (typeof open !== 'boolean') {
        return { error: { code: 'bad_args', message: 'cross_section_expand needs open true or false' } };
      }
      if (!isEnabled()) {
        return { error: { code: 'no_cross_section', message: 'Enable cross-section first' } };
      }
      const applied = panel.agentSetOptionsOpen(open);
      if (!applied) {
        return { error: { code: 'no_cross_section', message: 'Enable cross-section first' } };
      }
      const state = await waitForState((row) => row.enabled && row.optionsOpen === open);
      if (!state) {
        return { error: { code: 'internal', message: 'Cross-section options did not settle' } };
      }
      return { result: state };
    },

    crossSectionPlane({ plane } = {}) {
      const panelGate = requirePanel();
      if (panelGate.error) return panelGate;
      const { panel } = panelGate;
      const preset = String(plane || '').toUpperCase();
      if (!PRESET_IDS.includes(preset)) {
        return {
          error: {
            code: 'bad_args',
            message: `cross_section_plane needs plane ${PRESET_IDS.join('|')}`,
          },
        };
      }
      if (!isEnabled()) {
        return { error: { code: 'no_cross_section', message: 'Enable cross-section first' } };
      }
      panel.agentSetPreset(preset);
      const state = panel.readAgentState();
      return { result: { ...state, preset, plane: preset } };
    },

    crossSectionOffset({ offset } = {}) {
      const panelGate = requirePanel();
      if (panelGate.error) return panelGate;
      const { panel } = panelGate;
      const value = Number(offset);
      if (!Number.isFinite(value)) {
        return { error: { code: 'bad_args', message: 'cross_section_offset needs numeric offset' } };
      }
      if (!isEnabled()) {
        return { error: { code: 'no_cross_section', message: 'Enable cross-section first' } };
      }
      const state = panel.readAgentState();
      const clamped = Math.min(state.offsetMax, Math.max(state.offsetMin, value));
      panel.agentSetOffset(clamped);
      return { result: { ...panel.readAgentState(), offset: clamped } };
    },

    crossSectionState() {
      const panelGate = requirePanel();
      if (panelGate.error) return panelGate;
      const { panel } = panelGate;
      return { result: panel.readAgentState() };
    },
  };
}
