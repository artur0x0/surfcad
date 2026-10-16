import { PLANE_PRESETS } from '../utils/crossSection.js';

const PRESET_IDS = Object.freeze(Object.keys(PLANE_PRESETS));

export function createXsectionAgentHandlers(deps) {
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

  return {
    crossSectionToggle({ enabled } = {}) {
      const meshGate = requireMesh();
      if (meshGate.error) return meshGate;
      const panelGate = requirePanel();
      if (panelGate.error) return panelGate;
      const { panel } = panelGate;
      const was = !!deps.enabledRef?.current;
      const target = typeof enabled === 'boolean' ? enabled : !was;
      if (target === was) {
        return { result: { ...panel.readAgentState(), enabled: was } };
      }
      panel.agentSetEnabled(target);
      return { result: { ...panel.readAgentState(), enabled: target } };
    },

    crossSectionExpand({ open } = {}) {
      const panelGate = requirePanel();
      if (panelGate.error) return panelGate;
      const { panel } = panelGate;
      if (typeof open !== 'boolean') {
        return { error: { code: 'bad_args', message: 'cross_section_expand needs open true or false' } };
      }
      if (!deps.enabledRef?.current) {
        return { error: { code: 'no_cross_section', message: 'Enable cross-section first' } };
      }
      panel.agentSetOptionsOpen(open);
      return { result: panel.readAgentState() };
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
      if (!deps.enabledRef?.current) {
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
      if (!deps.enabledRef?.current) {
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
