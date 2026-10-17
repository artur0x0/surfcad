import { PLANE_PRESETS } from '../utils/crossSection.js';
import { crossSectionPlaneKey } from '../utils/crossSectionView.js';

const PRESET_IDS = Object.freeze(Object.keys(PLANE_PRESETS));
const SETTLE_MS = 400;
const APPLY_MS = 2500;
const POLL_MS = 40;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalsMatch(a, b) {
  if (!a || !b) return false;
  return crossSectionPlaneKey(a, 0) === crossSectionPlaneKey(b, 0);
}

export function createXsectionAgentHandlers(deps) {
  const sleepMs = deps.sleep ?? sleep;
  const settleMs = deps.settleMs ?? SETTLE_MS;
  const applyMs = deps.applyMs ?? APPLY_MS;
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

  function readLiveState() {
    const panel = deps.panelRef?.current;
    const state = panel?.readAgentState?.();
    if (!state) return null;
    const diag = deps.getDiagnostics?.() || {};
    const applied = deps.getAppliedPlane?.() ?? diag.appliedPlane ?? null;
    const appliedGen = deps.getAppliedGen?.() ?? diag.appliedGen ?? applied?.gen ?? 0;
    const merged = { ...state, ...diag, appliedPlane: applied, appliedGen };
    if (applied?.normal) {
      merged.normal = [...applied.normal];
      merged.originOffset = applied.originOffset;
      merged.offset = applied.originOffset;
    }
    return merged;
  }

  async function waitForState(match, { timeoutMs = settleMs } = {}) {
    const attempts = Math.ceil(timeoutMs / pollMs);
    for (let i = 0; i < attempts; i += 1) {
      const state = readLiveState();
      if (state && match(state)) {
        deps.panelRef?.current?.clearAgentSnap?.();
        return readLiveState() || state;
      }
      await sleepMs(pollMs);
    }
    const state = readLiveState();
    if (state && match(state)) {
      deps.panelRef?.current?.clearAgentSnap?.();
      return readLiveState() || state;
    }
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
        return { result: readLiveState() || panel.readAgentState() };
      }
      const genBefore = deps.getAppliedGen?.() ?? 0;
      panel.agentSetEnabled(target);
      if (target) {
        deps.enabledRef.current = true;
      } else {
        deps.enabledRef.current = false;
      }
      const wantOptionsOpen = target;
      const state = await waitForState(
        (row) => {
          if (row.enabled !== target || row.optionsOpen !== wantOptionsOpen) return false;
          if (!target) return true;
          return (row.appliedGen ?? 0) > genBefore && !!row.appliedPlane;
        },
        { timeoutMs: target ? applyMs : settleMs },
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

    async crossSectionPlane({ plane } = {}) {
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
      const wantNormal = PLANE_PRESETS[preset].normal;
      const genBefore = deps.getAppliedGen?.() ?? 0;
      panel.agentSetPreset(preset);
      const state = await waitForState(
        (row) => {
          if (row.plane !== preset && row.preset !== preset) return false;
          if ((row.appliedGen ?? 0) <= genBefore) return false;
          return normalsMatch(row.appliedPlane?.normal || row.normal, wantNormal);
        },
        { timeoutMs: applyMs },
      );
      if (!state) {
        return { error: { code: 'internal', message: 'Cross-section plane did not settle' } };
      }
      return { result: state };
    },

    async crossSectionOffset({ offset } = {}) {
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
      const snapshot = readLiveState() || panel.readAgentState();
      const clamped = Math.min(snapshot.offsetMax, Math.max(snapshot.offsetMin, value));
      const genBefore = deps.getAppliedGen?.() ?? 0;
      panel.agentSetOffset(clamped);
      const state = await waitForState(
        (row) => {
          if ((row.appliedGen ?? 0) <= genBefore) return false;
          const appliedOff = row.appliedPlane?.originOffset ?? row.originOffset ?? row.offset;
          return Math.abs(appliedOff - clamped) < 1e-4
            || Math.abs((row.offset ?? appliedOff) - clamped) < 1e-4;
        },
        { timeoutMs: applyMs },
      );
      if (!state) {
        return { error: { code: 'internal', message: 'Cross-section offset did not settle' } };
      }
      return { result: state };
    },

    crossSectionState() {
      const panelGate = requirePanel();
      if (panelGate.error) return panelGate;
      return { result: readLiveState() || panelGate.panel.readAgentState() };
    },
  };
}
