/* global window, document */
/**
 * Feature errors on the agent bridge: popup text, persistence, insert_move, partial failure.
 *
 * Scripted playtest (preview bundle, in-page bridge):
 *   npm run build:playtest && node scripts/playtest/run.mjs --scenario agent-feature-errors
 *
 * Dev-server playtest through surfcad-mcp (this file as main):
 *   node scripts/playtest/scenarios/agent-feature-errors.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentCall } from '../lib/harness.mjs';
import { createStepRunner } from '../lib/stepRunner.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const HARD_FAIL = `// --- cube begin id=cube1 ---
throw new Error('Cube failed: result is not a valid solid (NotManifold)');
let part = Manifold.cube([20, 20, 20], true);
// --- cube end ---
return part;
`;

const GOOD = `// --- cube begin id=cube1 ---
let part = Manifold.cube([20, 20, 20], true);
// --- cube end ---
return part;
`;

const PARTIAL = `// --- cube begin id=cube1 ---
let part = Manifold.cube([20, 20, 20], true);
// --- cube end ---
// --- fillet-mode begin id=fillet1 ---
const selEdges = edgesBetween(part, 90, 91);
const path = makeSweepPath(selEdges);
part = filletAlongPath(part, path, 2);
// --- fillet-mode end ---
return part;
`;

export const id = 'agent-feature-errors';
export const title = 'Agent feature errors match the viewport popup';
export const userId = 'user-playtest-feature-errors';

const SEED_SCRIPT = GOOD;

export function seedDoc() {
  return {
    format: 'surfcad.assembly',
    v: 1,
    name: 'playtest-feature-errors',
    activeId: 'local:part1',
    source: 'local',
    parts: [{ id: 'local:part1', name: 'Part (1)', visible: true, order: 0 }],
    joints: [],
  };
}

export function seedParts() {
  return [{ id: 'local:part1', script: SEED_SCRIPT }];
}

function featureRow(errors) {
  const rows = errors?.result?.errors || errors?.errors || [];
  return rows.find((row) => row && typeof row === 'object' && row.code === 'feature_failed') || rows[0] || null;
}

function showsMessage(popup, message, ...blobs) {
  const text = String(message || '');
  if (!text || !String(popup || '').includes(text)) return false;
  return blobs.every((blob) => JSON.stringify(blob).includes(text));
}

/**
 * Vertex count from the dev automation hooks. The playtest bundle leaves
 * those hooks out, so a production preview returns 0 even when the solid
 * is on screen.
 */
async function devMeshCount(page) {
  return page.evaluate(() => {
    const painted = window.__VIEWPORT__?._lastRenderedMesh;
    return painted?.geometry?.attributes?.position?.count
      || window.__MANIFOLD_CONTEXT__?.lastResult?.mesh?.vertProperties?.length
      || 0;
  });
}

/**
 * Off-white body samples in a viewport screenshot. The playtest bundle has
 * no `__VIEWPORT__` hook; the agent screenshot is the canvas after a render.
 * The clear color is #1e1e1e, so a recovered cube shows up as low-chroma light pixels.
 */
async function partBodySamples(page) {
  return page.evaluate(async () => {
    const env = await window.surfcad.call('screenshot', '{}');
    const dataUrl = env?.result?.dataUrl || '';
    if (!dataUrl.startsWith('data:image/png')) return 0;
    const img = document.createElement('img');
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('screenshot decode failed'));
      img.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    let samples = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (r + g + b > 360 && chroma < 40) samples += 1;
    }
    return samples;
  });
}

/**
 * @param {{ page: import('playwright-core').Page, outDir: string, findings: string[] }} ctx
 */
export async function run(ctx) {
  const { page, findings } = ctx;
  const runner = createStepRunner();

  await runner.runStep('failing feature matches the popup', async () => {
    const ran = await agentCall(page, 'set_script', { source: HARD_FAIL });
    const errs = await agentCall(page, 'errors', {});
    const status = await agentCall(page, 'status', {});
    const toasts = await agentCall(page, 'toasts', {});
    const popup = await page.locator('[data-execution-error]').innerText();
    const row = featureRow(errs);
    const ok = ran.ok === true
      && ran.result?.ok === false
      && status.result?.runState === 'failed'
      && row?.code === 'feature_failed'
      && row?.featureType === 'cube'
      && row?.featureLabel === 'Cube'
      && showsMessage(popup, row.message, ran.result, errs.result, toasts.result);
    if (!ok) findings.push(`feature error mismatch popup=${JSON.stringify(popup)} row=${JSON.stringify(row)}`);
    return {
      ok,
      call: 'set_script',
      args: { source: HARD_FAIL },
      envelope: { ran, errs, status, toasts, popup },
      detail: popup,
    };
  });

  await runner.runStep('a later failed insert keeps the feature error', async () => {
    const again = await agentCall(page, 'insert_fillet_edges', {});
    const errs = await agentCall(page, 'errors', {});
    const status = await agentCall(page, 'status', {});
    const row = featureRow(errs);
    const ok = again.ok === true
      && again.result?.ok === false
      && status.result?.runState === 'failed'
      && row?.message?.includes('Cube failed');
    return {
      ok,
      call: 'insert_fillet_edges',
      args: {},
      envelope: { again, errs, status },
      detail: row?.message || '',
    };
  });

  await runner.runStep('successful run clears the feature error', async () => {
    const ran = await agentCall(page, 'set_script', { source: GOOD });
    const errs = await agentCall(page, 'errors', {});
    const status = await agentCall(page, 'status', {});
    const popupGone = await page.locator('[data-execution-error]').count() === 0;
    const ok = ran.result?.ok === true
      && (errs.result?.errors || []).length === 0
      && status.result?.runState === 'ok'
      && popupGone;
    return {
      ok,
      call: 'set_script',
      args: { source: GOOD },
      envelope: { ran, errs, status },
      detail: status.result?.runState || '',
    };
  });

  await runner.runStep('insert_move X of 5000 is a descriptive bad_args', async () => {
    const env = await agentCall(page, 'insert_move', { dx: 5000, dy: 0, dz: 0 });
    const message = env.error?.message || '';
    const ok = env.ok === false
      && env.error?.code === 'bad_args'
      && /Move/.test(message)
      && /5000/.test(message)
      && /1000/.test(message);
    return {
      ok,
      call: 'insert_move',
      args: { dx: 5000, dy: 0, dz: 0 },
      envelope: env,
      detail: message,
    };
  });

  await runner.runStep('recovered solid is not a successful run', async () => {
    const ran = await agentCall(page, 'set_script', { source: PARTIAL });
    const errs = await agentCall(page, 'errors', {});
    const status = await agentCall(page, 'status', {});
    const toasts = await agentCall(page, 'toasts', {});
    const popup = await page.locator('[data-execution-error]').innerText();
    const row = featureRow(errs);
    const mesh = await devMeshCount(page);
    const bodySamples = mesh > 0 ? null : await partBodySamples(page);
    const solid = mesh > 0 || bodySamples >= 40;
    const checks = {
      resultOk: ran.result?.ok === false,
      runState: status.result?.runState === 'failed',
      code: row?.code === 'feature_failed',
      featureType: row?.featureType === 'fillet',
      featureLabel: !!row?.featureLabel,
      solid,
      message: showsMessage(popup, row?.message, ran.result, errs.result, toasts.result),
    };
    const ok = Object.values(checks).every(Boolean);
    if (!ok) {
      findings.push(`partial failure mismatch popup=${JSON.stringify(popup)} row=${JSON.stringify(row)} mesh=${mesh} bodySamples=${bodySamples}`);
    }
    return {
      ok,
      call: 'set_script',
      args: { source: PARTIAL },
      envelope: { ran, errs, status, toasts, popup, mesh, bodySamples },
      detail: ok
        ? `${row?.featureType} ${row?.featureLabel}`
        : JSON.stringify({ checks, featureType: row?.featureType, featureLabel: row?.featureLabel, mesh, bodySamples, message: row?.message }),
    };
  });

  return {
    id,
    title,
    ok: runner.failed === 0,
    steps: runner.steps,
    replaySteps: runner.replaySteps,
    screenshots: [],
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function popupMessage(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== 'Error' && line !== 'Undo' && line !== 'Dismiss')
    .join('\n')
    .trim();
}

async function popupText(page) {
  const loc = page.locator('[data-execution-error]');
  await loc.waitFor({ state: 'visible', timeout: 20000 });
  return popupMessage(await loc.innerText());
}

async function shotWithJson(page, outPath, payload) {
  mkdirSync(dirname(outPath), { recursive: true });
  await page.evaluate((json) => {
    document.getElementById('agent-error-json-panel')?.remove();
    const panel = document.createElement('pre');
    panel.id = 'agent-error-json-panel';
    panel.textContent = json;
    panel.setAttribute('style', [
      'position:fixed',
      'top:72px',
      'right:12px',
      'z-index:80',
      'width:440px',
      'max-height:70vh',
      'overflow:auto',
      'margin:0',
      'padding:12px',
      'background:#f8fafc',
      'color:#0f172a',
      'border:1px solid #94a3b8',
      'font:12px/1.4 ui-monospace,monospace',
      'white-space:pre-wrap',
      'text-align:left',
    ].join(';'));
    document.body.appendChild(panel);
  }, JSON.stringify(payload, null, 2));
  await page.screenshot({ path: outPath });
  await page.evaluate(() => document.getElementById('agent-error-json-panel')?.remove());
}

async function main() {
  const {
    assertLocalhost,
    findChrome,
    launchBrowser,
    openAgentPage,
    showAgentBridgePairingCode,
    waitForServer,
  } = await import('../lib/harness.mjs');
  const { pickFreePort } = await import('../lib/pickFreePort.mjs');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { probeRelayAtUrl } = await import('../../../packages/surfcad-mcp/src/bridge/relayServer.mjs');

  const exe = findChrome();
  if (!exe) {
    console.error('agent-feature-errors: no system Chrome (set CHROME_PATH)');
    process.exit(1);
  }

  const port = Number(process.env.PLAYTEST_PORT || 4178);
  const relayPort = process.env.SURFCAD_AGENT_BRIDGE_WS_PORT
    ? Number(process.env.SURFCAD_AGENT_BRIDGE_WS_PORT)
    : await pickFreePort();
  const relayUrl = `ws://127.0.0.1:${relayPort}`;
  const baseUrl = `http://127.0.0.1:${port}/?agent=1&agentBridgeWs=${encodeURIComponent(relayUrl)}`;
  assertLocalhost(baseUrl);

  const outDir = process.env.PLAYTEST_OUT || '/opt/cursor/artifacts';
  mkdirSync(outDir, { recursive: true });

  const server = spawn(
    'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SURFCAD_AGENT_BRIDGE_WS_PORT: String(relayPort) },
    },
  );
  const log = [];
  server.stdout?.on('data', (buf) => log.push(String(buf)));
  server.stderr?.on('data', (buf) => log.push(String(buf)));
  const stopServer = () => {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
    try { server.kill('SIGKILL'); } catch { /* gone */ }
  };

  let browser;
  let client;
  const report = [];
  let failed = 0;
  const check = (name, cond, detail = '') => {
    const line = `${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`;
    console.log(line);
    report.push(line);
    if (!cond) failed += 1;
  };

  async function tool(name, args = {}) {
    const out = await client.callTool({ name, arguments: args });
    const text = out?.content?.[0]?.text || '';
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    return { isError: out?.isError === true, body };
  }

  try {
    if (!(await waitForServer(`http://127.0.0.1:${port}/`, 120000))) {
      throw new Error(`dev server did not start\n${log.slice(-40).join('')}`);
    }
    const relayUp = await (async () => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (await probeRelayAtUrl(relayUrl, 400)) return true;
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    })();
    if (!relayUp) throw new Error(`relay did not listen on ${relayUrl}\n${log.slice(-40).join('')}`);

    browser = await launchBrowser(exe);
    const { page } = await openAgentPage(browser, {
      width: 1280,
      height: 800,
      baseUrl,
      userId,
      assembly: seedDoc(),
      parts: seedParts(),
    });

    const pairingCode = await showAgentBridgePairingCode(page);
    if (!pairingCode || pairingCode.length < 4) throw new Error('pairing code not shown');
    console.log(`pairing code ${pairingCode}`);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(ROOT, 'packages/surfcad-mcp/bin/surfcad-mcp.js')],
      env: {
        ...process.env,
        SURFCAD_MCP_START_RELAY: '0',
        SURFCAD_AGENT_BRIDGE_WS_URL: relayUrl,
        SURFCAD_PAIRING_CODE: '',
      },
    });
    client = new Client({ name: 'surfcad-feature-errors', version: '0.2.1' });
    await client.connect(transport);

    const pairPromise = client.callTool({ name: 'pair', arguments: { code: pairingCode } });
    const approve = page.locator('[data-ui-action="data-agent-bridge-approve"]');
    await approve.waitFor({ state: 'visible', timeout: 20000 });
    await approve.click();
    const paired = await pairPromise;
    const pairedText = paired?.content?.[0]?.text || '';
    check('paired through surfcad-mcp', !paired?.isError, pairedText.slice(0, 180));

    const ran = await tool('set_script', { source: HARD_FAIL });
    const popup = await popupText(page);
    const errs = await tool('errors', {});
    const status = await tool('status', {});
    const toasts = await tool('toasts', {});
    const row = (errs.body?.errors || [])[0] || null;
    const toastHit = (toasts.body?.toasts || []).some((item) => item.id === 'execution-error' && String(item.message || '').includes(row?.message || '___'));
    check('hard fail result.ok is false', ran.body?.ok === false, JSON.stringify(ran.body?.errors));
    check('popup, errors, run, and toasts share the message', !!row && popup.includes(row.message) && (ran.body?.errors || []).includes(row.message) && toastHit, popup);
    check('feature type and label', row?.code === 'feature_failed' && row?.featureType === 'cube' && row?.featureLabel === 'Cube', JSON.stringify(row));
    check('status stays failed', status.body?.runState === 'failed');
    const hardShot = join(outDir, 'feature-error-popup.png');
    await shotWithJson(page, hardShot, {
      popup,
      run: ran.body,
      errors: errs.body,
      status: { runState: status.body?.runState, volume: status.body?.volume },
      toasts: toasts.body,
    });

    const again = await tool('insert_fillet_edges', {});
    const still = await tool('errors', {});
    const stillStatus = await tool('status', {});
    check(
      'a later failed insert is not ok',
      again.isError !== true && again.body?.ok === false && (again.body?.errors || []).includes(row?.message),
      JSON.stringify(again.body?.errors || again.body),
    );
    check('feature error persists after that insert', (still.body?.errors || [])[0]?.message === row?.message && stillStatus.body?.runState === 'failed');
    await shotWithJson(page, join(outDir, 'feature-error-persists.png'), {
      popup: await popupText(page),
      laterInsert: again.body,
      errors: still.body,
      status: { runState: stillStatus.body?.runState },
    });

    const cleared = await tool('set_script', { source: GOOD });
    const clearedErrors = await tool('errors', {});
    const clearedStatus = await tool('status', {});
    await page.locator('[data-execution-error]').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
    const popupLeft = await page.locator('[data-execution-error]').count();
    check('good script is ok', cleared.body?.ok === true && (cleared.body?.errors || []).length === 0);
    check('errors and status clear', (clearedErrors.body?.errors || []).length === 0 && clearedStatus.body?.runState === 'ok' && popupLeft === 0, clearedStatus.body?.runState);
    await shotWithJson(page, join(outDir, 'feature-error-cleared.png'), {
      run: { ok: cleared.body?.ok, errors: cleared.body?.errors, runState: cleared.body?.status?.runState },
      errors: clearedErrors.body,
      status: { runState: clearedStatus.body?.runState, volume: clearedStatus.body?.volume },
    });

    const moved = await tool('insert_move', { dx: 5000, dy: 0, dz: 0 });
    const moveMessage = moved.body?.message || '';
    check(
      'insert_move dx 5000 is bad_args',
      moved.isError === true && moved.body?.code === 'bad_args' && /Move/.test(moveMessage) && /5000/.test(moveMessage) && /1000/.test(moveMessage),
      moveMessage,
    );
    await shotWithJson(page, join(outDir, 'insert-move-bad-args.png'), moved.body);

    const partial = await tool('set_script', { source: PARTIAL });
    const partialPopup = await popupText(page);
    const partialErrors = await tool('errors', {});
    const partialStatus = await tool('status', {});
    const partialToasts = await tool('toasts', {});
    const partialRow = (partialErrors.body?.errors || [])[0] || null;
    const mesh = await page.evaluate(() => {
      const painted = window.__VIEWPORT__?._lastRenderedMesh;
      return painted?.geometry?.attributes?.position?.count
        || window.__MANIFOLD_CONTEXT__?.lastResult?.mesh?.vertProperties?.length
        || 0;
    });
    check('partial failure is not ok', partial.body?.ok === false, JSON.stringify(partial.body?.errors));
    check('recovered solid stays on screen', mesh > 0, String(mesh));
    check(
      'partial popup matches fillet type and label',
      partialRow?.code === 'feature_failed'
        && partialRow?.featureType === 'fillet'
        && !!partialRow?.featureLabel
        && partialPopup.includes(partialRow.message)
        && (partial.body?.errors || []).includes(partialRow.message)
        && partialStatus.body?.runState === 'failed'
        && (partialToasts.body?.toasts || []).some((item) => item.message === partialRow.message),
      `${partialRow?.featureType} ${partialRow?.featureLabel} ${partialPopup}`,
    );
    await shotWithJson(page, join(outDir, 'partial-failure.png'), {
      popup: partialPopup,
      meshVerts: mesh,
      run: partial.body,
      errors: partialErrors.body,
      status: { runState: partialStatus.body?.runState, volume: partialStatus.body?.volume },
      toasts: partialToasts.body,
    });

    writeFileSync(join(outDir, 'feature-error-playtest.txt'), `${report.join('\n')}\n`);
    if (failed) {
      console.error(`\n${failed} check(s) failed`);
      process.exitCode = 1;
    } else {
      console.log('\nagent feature errors: all checks passed');
    }
  } catch (err) {
    console.error(err);
    writeFileSync(join(outDir, 'vite-dev.log'), log.join(''));
    process.exitCode = 1;
  } finally {
    try { await client?.close(); } catch { /* gone */ }
    try { await browser?.close(); } catch { /* gone */ }
    stopServer();
  }
}

if (isMain) {
  main();
}
