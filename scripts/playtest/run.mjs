#!/usr/bin/env node
/**
 * Scripted agent playtest: drives window.surfcad only (external-agent path).
 *
 * Usage:
 *   npm run build:playtest && node scripts/playtest/run.mjs
 *   node scripts/playtest/run.mjs --scenario bracket-holes-fillet
 *
 * Env:
 *   PLAYTEST_PORT (default 4174)
 *   PLAYTEST_OUT  (report directory)
 *   SURFCAD_AGENT_BRIDGE_WS_PORT — relay port for vite preview (default: ephemeral free port)
 *   CHROME_PATH
 *   AGENT_VISIBLE=1  — slower visible cues (?visible=1&visibleDelay=350)
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertLocalhost,
  defaultOutDir,
  findChrome,
  launchBrowser,
  openAgentPage,
  startPreviewServer,
  waitForServer,
} from './lib/harness.mjs';
import { pickFreePort } from './lib/pickFreePort.mjs';
import { writeReport } from './lib/report.mjs';
import { scenarios, getScenario } from './scenarios/index.mjs';

const PORT = Number(process.env.PLAYTEST_PORT || 4174);
const VISIBLE = process.env.AGENT_VISIBLE === '1' || process.env.AGENT_VISIBLE === 'true';
const VISIBLE_QS = VISIBLE ? '&visible=1&visibleDelay=350' : '';
const BASE_URL = process.env.PLAYTEST_URL || `http://127.0.0.1:${PORT}/?agent=1${VISIBLE_QS}`;

const args = process.argv.slice(2);
const scenarioArgIdx = args.indexOf('--scenario');
const onlyId = scenarioArgIdx >= 0 ? args[scenarioArgIdx + 1] : null;

assertLocalhost(BASE_URL);

const exe = findChrome();
if (!exe) {
  console.error('playtest: no system Chrome — set CHROME_PATH');
  process.exit(1);
}

const outDir = defaultOutDir();
mkdirSync(outDir, { recursive: true });

const startedAt = new Date().toISOString();
const t0 = Date.now();

const selected = onlyId
  ? [getScenario(onlyId)].filter(Boolean)
  : scenarios;

if (!selected.length) {
  console.error(`playtest: unknown scenario "${onlyId}"`);
  process.exit(1);
}

const findings = [
  'On a 40×30×20 box with one centered hole, list_edges returns on the order of 156 raw mesh edges (not stable topology ids); prefer faceKeyA/faceKeyB pairs when listing adjacent faces.',
];

const relayPort = process.env.SURFCAD_AGENT_BRIDGE_WS_PORT
  ? Number(process.env.SURFCAD_AGENT_BRIDGE_WS_PORT)
  : await pickFreePort();
const { stop } = startPreviewServer(PORT, {
  SURFCAD_AGENT_BRIDGE_WS_PORT: String(relayPort),
});
let browser;
const allConsoleErrors = [];
const scenarioReports = [];

try {
  if (!(await waitForServer(`http://127.0.0.1:${PORT}/`))) {
    throw new Error('preview server did not start');
  }

  browser = await launchBrowser(exe);

  for (const mod of selected) {
    const scenarioT0 = Date.now();
    const { page, consoleErrors } = await openAgentPage(browser, {
      width: 1280,
      height: 800,
      baseUrl: BASE_URL,
      userId: mod.userId,
      assembly: mod.seedDoc(),
      parts: mod.seedParts(),
    });

    const result = await mod.run({
      page,
      outDir,
      findings,
      mobileScreenshot: mod.mobileScreenshot === true,
    });

    allConsoleErrors.push(...consoleErrors);
    scenarioReports.push({
      ...result,
      durationMs: Date.now() - scenarioT0,
    });

    await page.close();
  }
} finally {
  if (browser) await browser.close();
  stop();
}

const invariants = [];

const totalSteps = scenarioReports.reduce((n, s) => n + s.steps.length, 0);
const failedSteps = scenarioReports.reduce(
  (n, s) => n + s.steps.filter((row) => !row.ok).length,
  0,
);

invariants.push({
  id: 'no_console_errors',
  ok: allConsoleErrors.length === 0,
  detail: allConsoleErrors.slice(0, 3).join(' | '),
});

const ok = failedSteps === 0 && invariants.every((row) => row.ok);

const replay = {
  v: 1,
  baseUrl: BASE_URL,
  scenarios: scenarioReports.map((s) => ({
    id: s.id,
    userId: selected.find((m) => m.id === s.id)?.userId,
    steps: s.replaySteps || [],
  })),
};

const finishedAt = new Date().toISOString();
const report = {
  v: 1,
  ok,
  startedAt,
  finishedAt,
  durationMs: Date.now() - t0,
  baseUrl: BASE_URL,
  findings,
  totals: { steps: totalSteps, passed: totalSteps - failedSteps, failed: failedSteps },
  scenarios: scenarioReports,
  invariants,
  consoleErrors: allConsoleErrors,
  replay,
};

const { jsonPath, mdPath } = writeReport(outDir, report);
writeReport(join(outDir, 'latest'), report);

console.log(`playtest: ${ok ? 'PASS' : 'FAIL'} — ${failedSteps} failed step(s)`);
if (!ok) {
  for (const scenario of scenarioReports) {
    for (const step of scenario.steps || []) {
      if (step.ok) continue;
      let extra = step.detail || '';
      if (!extra && step.envelope) {
        try { extra = JSON.stringify(step.envelope).slice(0, 400); } catch { extra = ''; }
      }
      console.log(`  failed step [${scenario.id}] ${step.id}${extra ? ` — ${extra}` : ''}`);
    }
  }
  for (const inv of invariants) {
    if (inv.ok) continue;
    console.log(`  failed invariant ${inv.id}${inv.detail ? `: ${inv.detail}` : ''}`);
  }
}
console.log(`  report ${jsonPath}`);
console.log(`  summary ${mdPath}`);

process.exit(ok ? 0 : 1);
