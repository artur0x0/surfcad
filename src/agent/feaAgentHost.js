import { resolveFaceKeys } from './resolvePickIds.js';
import { fingerprintsFromGeometry } from '../utils/facePaint.js';
import { studyMemberIds } from '../fea/feaPickGate.js';

const SETTLE_MS = 400;
const RUN_TIMEOUT_MS = 180_000;
const RUN_POLL_MS = 80;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeResult(panel) {
  const result = panel?.result || null;
  const report = panel?.runReport || null;
  const status = report?.status === 'done'
    ? 'done'
    : (report?.status === 'stopped' ? (report?.outcome || 'stopped') : (panel?.running ? 'running' : (report?.status || 'idle')));
  const dof = report?.dofs ?? result?.stats?.dofs ?? null;
  const timing = {
    ms: result?.stats?.ms ?? null,
    dofs: dof,
    stage: report?.stage || null,
  };
  const dispMm = result?.displacementMax;
  const maxDisplacement_m = (typeof dispMm === 'number' && Number.isFinite(dispMm)) ? dispMm / 1000 : null;
  const summary = {
    status,
    stale: result?.stale === true,
    dof,
    timing,
    source: result?.source || null,
    maxVonMises_MPa: result?.max ?? null,
    p95VonMises_MPa: result?.p95 ?? null,
    maxDisplacement_m,
    safetyFactor: result?.safetyFactor ?? null,
    frequenciesHz: Array.isArray(result?.frequenciesHz) ? result.frequenciesHz.slice(0, 8) : null,
    contact: result?.contactActive ? {
      open: result.contactOpen ?? 0,
      stick: result.contactStick ?? 0,
      slip: result.contactSlip ?? 0,
      pressureMax_MPa: result.contactPressureMax ?? null,
    } : null,
    warnings: Array.isArray(result?.warnings) ? result.warnings.map((w) => w?.code || w?.msg || w) : [],
  };
  return summary;
}

function compactStudyState(panel) {
  const study = panel?.study || {};
  return {
    open: !!panel?.open,
    screen: panel?.screen || 'setup',
    results: !!panel?.results,
    running: !!panel?.running,
    progress: panel?.progress || '',
    materialId: study?.material?.id || null,
    studyType: study?.type || 'static',
    fixtureCount: Array.isArray(study?.fixtures) ? study.fixtures.length : 0,
    loadCount: Array.isArray(study?.loads) ? study.loads.length : 0,
    analyzedPartId: panel?.analyzedPartId || '',
    memberIds: Array.isArray(panel?.memberIds) ? panel.memberIds.slice() : [],
    draft: {
      target: panel?.draft?.target || 'fixture',
      magnitudeN: panel?.draft?.magnitudeN ?? null,
      direction: panel?.draft?.direction || null,
      pressureMPa: panel?.draft?.pressureMPa ?? null,
    },
    notice: panel?.notice || '',
  };
}

export function createFeaAgentHandlers(deps) {
  const runTimeoutMs = deps.runTimeoutMs ?? RUN_TIMEOUT_MS;
  const runPollMs = deps.runPollMs ?? RUN_POLL_MS;
  const sleepMs = deps.sleep ?? sleep;
  const meshContext = (partId) => {
    const mesh = deps.getMesh?.();
    const geometry = mesh?.geometry;
    const positions = geometry?.attributes?.position;
    const index = geometry?.index?.array;
    if (!geometry || !positions?.array || !index?.length) {
      return { error: { code: 'no_mesh', message: 'No mesh to pick FEA faces on' } };
    }
    const faceIDs = deps.faceIDsRef?.current;
    const fingerprints = fingerprintsFromGeometry(geometry, faceIDs);
    const activePart = deps.activePartIdRef?.current || '';
    const resolvedPart = partId != null && partId !== '' ? String(partId) : String(activePart);
    return {
      mesh,
      geometry,
      positions: positions.array,
      index,
      faceIDs,
      fingerprints,
      partId: resolvedPart,
    };
  };

  function requirePanel({ mustBeOpen = true } = {}) {
    const panel = deps.panelRef?.current;
    if (!panel) {
      return { error: { code: 'internal', message: 'FEA panel is not mounted' } };
    }
    if (mustBeOpen && !panel.open) {
      return { error: { code: 'no_fea', message: 'Open Analyze first (fea_open)' } };
    }
    return { panel };
  }

  function assertStudyPart(panel, partId) {
    if (!partId) return null;
    const members = studyMemberIds(panel.study, panel.assemblyParts || [], panel.analyzedPartId);
    if (!members.includes(String(partId))) {
      return {
        error: {
          code: 'off_study_part',
          message: `Part ${partId} is not in this study scope`,
        },
      };
    }
    return null;
  }

  function facePickFromArgs(panel, args = {}) {
    const rawPartId = args.part_id ?? args.partId ?? null;
    const ctx = meshContext(rawPartId);
    if (ctx.error) return ctx;
    const off = assertStudyPart(panel, ctx.partId);
    if (off) return off;
    let indices = null;
    let normal = null;
    const faceId = args.face_id ?? args.faceID;
    if (faceId != null && faceId !== '') {
      const id = Number(faceId);
      if (!Number.isInteger(id) || id < 0) {
        return { error: { code: 'bad_args', message: 'face_id must be a non-negative integer' } };
      }
      const ids = ctx.faceIDs;
      if (!ids?.length) {
        return { error: { code: 'unknown_face', message: 'Mesh has no face ids' } };
      }
      const tris = [];
      for (let i = 0; i < ids.length; i += 1) {
        if (Number(ids[i]) === id) tris.push(i);
      }
      if (!tris.length) {
        return { error: { code: 'unknown_face', message: `No triangles with face_id ${id}` } };
      }
      const owner = ctx.fingerprints.find((face) => Array.isArray(face.tris) && face.tris.some((t) => tris.includes(t)));
      normal = owner?.n || null;
      indices = tris;
    } else {
      const keys = Array.isArray(args.keys) ? args.keys
        : (Array.isArray(args.face_keys) ? args.face_keys : (args.key ? [args.key] : []));
      if (!keys.length) {
        return { error: { code: 'bad_args', message: 'fea pick needs face_id or keys' } };
      }
      const resolved = resolveFaceKeys(ctx.fingerprints, keys);
      if (resolved.error) return resolved;
      const row = resolved.picks[0];
      indices = row?.indices?.length ? row.indices : null;
      normal = row?.normal || null;
      if (!indices?.length) {
        return { error: { code: 'unknown_face', message: 'Face key did not resolve to triangles' } };
      }
    }
    const seedFaceIndex = indices[0];
    const clickData = {
      geometry: ctx.geometry,
      partId: ctx.partId,
      seedFaceIndex,
      faceNormal: normal,
    };
    return { clickData };
  }

  async function waitForOpen() {
    for (let i = 0; i < Math.ceil(SETTLE_MS / 40); i += 1) {
      if (deps.panelRef?.current?.open) return true;
      await sleep(40);
    }
    return !!deps.panelRef?.current?.open;
  }

  return {
    async feaOpen() {
      if (deps.appMode === 'game') {
        return { error: { code: 'bad_view', message: 'Analyze is not available in game mode' } };
      }
      if (deps.panelRef?.current?.open) {
        return { result: { open: true, already: true } };
      }
      deps.feaToggleRef?.current?.();
      const ok = await waitForOpen();
      if (!ok) {
        return { error: { code: 'open_failed', message: 'Analyze did not open' } };
      }
      return { result: { open: true } };
    },

    feaClose() {
      if (!deps.panelRef?.current?.open) {
        return { result: { open: false, already: true } };
      }
      deps.feaCloseRef?.current?.();
      return { result: { open: false } };
    },

    feaSetMaterial({ id } = {}) {
      const req = requirePanel();
      if (req.error) return req;
      if (!id || typeof id !== 'string') {
        return { error: { code: 'bad_args', message: 'fea_set_material needs id' } };
      }
      req.panel.setMaterialId(id);
      return { result: { materialId: id } };
    },

    feaSetTarget({ target } = {}) {
      const req = requirePanel();
      if (req.error) return req;
      const allowed = new Set(['fixture', 'force', 'pressure']);
      if (!allowed.has(target)) {
        return { error: { code: 'bad_args', message: 'target must be fixture, force, or pressure' } };
      }
      req.panel.setTarget(target);
      return { result: { target } };
    },

    feaSetMagnitude({ magnitude, magnitudeN } = {}) {
      const req = requirePanel();
      if (req.error) return req;
      const value = magnitudeN ?? magnitude;
      if (!(typeof value === 'number' && Number.isFinite(value))) {
        return { error: { code: 'bad_args', message: 'magnitudeN must be a finite number (newtons, N)' } };
      }
      req.panel.setMagnitude(value);
      return { result: { magnitudeN: value } };
    },

    feaSetDirection({ direction } = {}) {
      const req = requirePanel();
      if (req.error) return req;
      if (direction == null) {
        return { error: { code: 'bad_args', message: 'fea_set_direction needs direction' } };
      }
      if (Array.isArray(direction)) {
        req.panel.setDirection(direction);
        return { result: { direction } };
      }
      req.panel.setDirection(String(direction));
      return { result: { direction: String(direction) } };
    },

    feaSetPressure({ pressure, pressureMPa } = {}) {
      const req = requirePanel();
      if (req.error) return req;
      const value = pressureMPa ?? pressure;
      if (!(typeof value === 'number' && Number.isFinite(value))) {
        return { error: { code: 'bad_args', message: 'pressureMPa must be a finite number (MPa)' } };
      }
      req.panel.setPressure(value);
      return { result: { pressureMPa: value } };
    },

    feaPick(args = {}) {
      const req = requirePanel();
      if (req.error) return req;
      const built = facePickFromArgs(req.panel, args);
      if (built.error) return built;
      try {
        const ok = req.panel.pick(built.clickData);
        if (!ok) {
          return { error: { code: 'pick_rejected', message: 'Face was not applied to the study' } };
        }
      } catch (err) {
        return { error: { code: 'pick_failed', message: err?.message || 'FEA pick failed' } };
      }
      return { result: { ok: true } };
    },

    feaSetFixture(args = {}) {
      const req = requirePanel();
      if (req.error) return req;
      req.panel.setTarget('fixture');
      const built = facePickFromArgs(req.panel, args);
      if (built.error) return built;
      try {
        const ok = req.panel.pick(built.clickData);
        if (!ok) return { error: { code: 'pick_rejected', message: 'Fixture face was not applied' } };
      } catch (err) {
        return { error: { code: 'pick_failed', message: err?.message || 'Fixture pick failed' } };
      }
      return { result: { ok: true, target: 'fixture' } };
    },

    feaSetForce(args = {}) {
      const req = requirePanel();
      if (req.error) return req;
      req.panel.setTarget('force');
      if (args.magnitude != null || args.magnitudeN != null) {
        const mag = this.feaSetMagnitude(args);
        if (mag.error) return mag;
      }
      if (args.direction != null) {
        const dir = this.feaSetDirection({ direction: args.direction });
        if (dir.error) return dir;
      }
      const hasFace = args.face_id != null || args.faceID != null
        || (Array.isArray(args.keys) && args.keys.length)
        || (Array.isArray(args.face_keys) && args.face_keys.length)
        || args.key;
      if (!hasFace) {
        return { result: { ok: true, target: 'force', picked: false } };
      }
      const built = facePickFromArgs(req.panel, args);
      if (built.error) return built;
      try {
        const ok = req.panel.pick(built.clickData);
        if (!ok) return { error: { code: 'pick_rejected', message: 'Force face was not applied' } };
      } catch (err) {
        return { error: { code: 'pick_failed', message: err?.message || 'Force pick failed' } };
      }
      return { result: { ok: true, target: 'force', picked: true } };
    },

    feaSetPressureLoad(args = {}) {
      const req = requirePanel();
      if (req.error) return req;
      req.panel.setTarget('pressure');
      if (args.pressure != null || args.pressureMPa != null) {
        const p = this.feaSetPressure(args);
        if (p.error) return p;
      }
      const hasFace = args.face_id != null || args.faceID != null
        || (Array.isArray(args.keys) && args.keys.length)
        || (Array.isArray(args.face_keys) && args.face_keys.length)
        || args.key;
      if (!hasFace) {
        return { result: { ok: true, target: 'pressure', picked: false } };
      }
      const built = facePickFromArgs(req.panel, args);
      if (built.error) return built;
      try {
        const ok = req.panel.pick(built.clickData);
        if (!ok) return { error: { code: 'pick_rejected', message: 'Pressure face was not applied' } };
      } catch (err) {
        return { error: { code: 'pick_failed', message: err?.message || 'Pressure pick failed' } };
      }
      return { result: { ok: true, target: 'pressure', picked: true } };
    },

    feaRemoveFixture({ index } = {}) {
      const req = requirePanel();
      if (req.error) return req;
      const i = Number(index);
      if (!Number.isInteger(i) || i < 0) {
        return { error: { code: 'bad_args', message: 'fea_remove_fixture needs non-negative index' } };
      }
      req.panel.removeFixture(i);
      return { result: { ok: true, index: i } };
    },

    feaRemoveLoad({ index } = {}) {
      const req = requirePanel();
      if (req.error) return req;
      const i = Number(index);
      if (!Number.isInteger(i) || i < 0) {
        return { error: { code: 'bad_args', message: 'fea_remove_load needs non-negative index' } };
      }
      req.panel.removeLoad(i);
      return { result: { ok: true, index: i } };
    },

    async feaRun() {
      const req = requirePanel();
      if (req.error) return req;
      if (req.panel.running) {
        return { error: { code: 'busy', message: 'A study is already running' } };
      }
      try {
        await req.panel.run();
      } catch (err) {
        return {
          error: {
            code: 'run_failed',
            message: err?.message || 'The study did not run',
          },
        };
      }
      const deadline = Date.now() + runTimeoutMs;
      while (Date.now() < deadline) {
        const live = deps.panelRef?.current;
        if (!live) break;
        const reportStatus = live.runReport?.status;
        const runFinished = !live.running
          && (reportStatus === 'done' || reportStatus === 'stopped' || reportStatus === 'idle');
        if (!runFinished) {
          await sleepMs(runPollMs);
          continue;
        }
        if (reportStatus === 'done' && live.result?.source === 'tet10' && live.result?.stats == null) {
          const peak = live.result?.max;
          if (typeof peak === 'number' && Number.isFinite(peak) && peak > 0) {
            break;
          }
          await sleepMs(runPollMs);
          continue;
        }
        break;
      }
      const timedOut = Date.now() >= deadline;
      const panel = deps.panelRef?.current;
      if (panel?.running) {
        return { error: { code: 'timeout', message: 'fea_run timed out before the solver finished' } };
      }
      const missingTet10Stats = panel?.runReport?.status === 'done'
        && panel?.result?.source === 'tet10'
        && panel?.result?.stats == null;
      if (timedOut && missingTet10Stats) {
        return { error: { code: 'timeout', message: 'stats not available' } };
      }
      return { result: summarizeResult(panel) };
    },

    feaCancel() {
      const req = requirePanel();
      if (req.error) return req;
      req.panel.cancel();
      return { result: { ok: true } };
    },

    feaBackToSetup() {
      const req = requirePanel();
      if (req.error) return req;
      req.panel.backToSetup();
      return { result: { screen: deps.panelRef?.current?.screen || 'setup' } };
    },

    feaState({ include } = {}) {
      const panel = deps.panelRef?.current;
      if (!panel?.open) {
        return { result: { open: false } };
      }
      const result = compactStudyState(panel);
      const bag = Array.isArray(include) ? new Set(include) : new Set();
      if (bag.has('summary') || bag.has('results')) {
        result.summary = summarizeResult(panel);
      }
      if (bag.has('probes') && Array.isArray(panel.probeRows)) {
        result.probes = panel.probeRows.map((row) => ({
          id: row.id,
          quantity: row.quantity,
          unit: row.unit,
          value: row.value,
        }));
      }
      return { result };
    },

    feaResults(opts = {}) {
      const req = requirePanel();
      if (req.error) return req;
      const summary = summarizeResult(req.panel);
      const bag = Array.isArray(opts?.include) ? new Set(opts.include) : new Set();
      const out = { ...summary, screen: req.panel.screen };
      if (bag.has('probes') && Array.isArray(req.panel.probeRows)) {
        out.probes = req.panel.probeRows;
      }
      return { result: out };
    },
  };
}
