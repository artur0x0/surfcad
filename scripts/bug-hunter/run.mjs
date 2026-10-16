#!/usr/bin/env node
/**
 * Bug hunter: regression seeds + optional LLM explorer over the agent bridge.
 *
 * Usage:
 *   npm run bug-hunter
 *   npm run bug-hunter -- --seeds-only
 *   npm run bug-hunter -- --explore
 *
 * Env:
 *   SURFCAD_LLM_BASE_URL / OPENAI_BASE_URL (default OpenAI v1)
 *   SURFCAD_LLM_API_KEY / OPENAI_API_KEY
 *   SURFCAD_LLM_MODEL / OPENAI_MODEL (default gpt-4o-mini)
 *   BUG_HUNTER_MAX_STEPS (default 24)
 *   BUG_HUNTER_MAX_COST_USD (default 0.25)
 *   BUG_HUNTER_OUT (default reports/bug-hunter)
 *   PLAYTEST_PORT, CHROME_PATH, SURFCAD_AGENT_BRIDGE_WS_PORT
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertLocalhost,
  findChrome,
  launchBrowser,
  openAgentPage,
  startPreviewServer,
  waitForServer,
  agentCall,
} from '../playtest/lib/harness.mjs';
import { pickFreePort } from '../playtest/lib/pickFreePort.mjs';
import { regressionSeeds } from './seeds/index.mjs';
import { readBudgetConfig, readLlmConfig, defaultReportDir } from './lib/config.mjs';
import { createBudget } from './lib/budget.mjs';
import { createLlmClient } from './lib/llmClient.mjs';
import { runExplorerLoop, runDeterministicProbe } from './lib/explorer.mjs';
import { minimizeSteps } from './lib/minimize.mjs';
import { writeBugHunterReport } from './lib/report.mjs';
import { mergeFindings, readBridgeHealth, probeEmptyNumberBoxes, consoleFindings } from './lib/invariants.mjs';

const PORT = Number(process.env.PLAYTEST_PORT || 4175);
const BASE_URL = process.env.PLAYTEST_URL || `http://127.0.0.1:${PORT}/?agent=1`;
const args = process.argv.slice(2);
const seedsOnly = args.includes('--seeds-only');
const forceExplore = args.includes('--explore');

assertLocalhost(BASE_URL);

const exe = findChrome();
if (!exe) {
  console.error('bug-hunter: no system Chrome — set CHROME_PATH');
  process.exit(1);
}

const outDir = defaultReportDir();
mkdirSync(outDir, { recursive: true });

const llmCfg = readLlmConfig();
const budgetCfg = readBudgetConfig();
const budget = createBudget({ ...budgetCfg, model: llmCfg.model });
const llm = createLlmClient();

const startedAt = new Date().toISOString();
const t0 = Date.now();

const relayPort = process.env.SURFCAD_AGENT_BRIDGE_WS_PORT
  ? Number(process.env.SURFCAD_AGENT_BRIDGE_WS_PORT)
  : await pickFreePort();

const { stop } = startPreviewServer(PORT, {
  SURFCAD_AGENT_BRIDGE_WS_PORT: String(relayPort),
});

const seedReports = [];
let explorerTrace = [];
let findings = [];

try {
  if (!(await waitForServer(`http://127.0.0.1:${PORT}/`))) {
    throw new Error('preview server did not start');
  }

  const browser = await launchBrowser(exe);

  for (const mod of regressionSeeds) {
    const { page } = await openAgentPage(browser, {
      width: 1280,
      height: 800,
      baseUrl: BASE_URL,
      userId: mod.userId,
      assembly: mod.seedDoc(),
      parts: mod.seedParts(),
    });
    const report = await mod.run({ page, outDir });
    seedReports.push(report);
    if (!report.ok) {
      findings.push({
        id: report.id,
        title: `Regression seed failed: ${report.title}`,
        summary: report.detail || report.steps?.filter((s) => !s.ok).map((s) => s.id).join(', '),
        steps: [],
        screenshots: report.screenshots || [],
      });
    }
    await page.close();
  }

  const seedsOk = seedReports.every((r) => r.ok);
  if (!seedsOk) {
    console.error('bug-hunter: regression seed(s) failed — skipping explorer');
  } else if (!seedsOnly) {
    const explore = forceExplore || llm.configured;
    if (forceExplore && !llm.configured) {
      throw new Error('bug-hunter: --explore requires SURFCAD_LLM_API_KEY or OPENAI_API_KEY');
    }
    if (explore && llm.configured) {
      const starter = regressionSeeds[0];
      const { page, consoleErrors } = await openAgentPage(browser, {
        width: 1280,
        height: 800,
        baseUrl: BASE_URL,
        userId: starter.userId,
        assembly: starter.seedDoc(),
        parts: starter.seedParts(),
      });

      const explorerResult = await runExplorerLoop({
        page,
        agentCall,
        llm,
        budget,
        consoleErrors,
        async onFinding(finding) {
          const steps = finding.steps || [];
          if (!steps.length) return;
          const targetIds = new Set((finding.invariantHits || []).map((r) => r.id));
          const stillBroken = async (prefix) => {
            const { page: p2, consoleErrors: errs } = await openAgentPage(browser, {
              width: 1280,
              height: 800,
              baseUrl: BASE_URL,
              userId: starter.userId,
              assembly: starter.seedDoc(),
              parts: starter.seedParts(),
            });
            try {
              for (const step of prefix) {
                await agentCall(p2, step.command, step.args);
              }
              const health = await readBridgeHealth(p2, agentCall);
              const emptyBoxes = await probeEmptyNumberBoxes(p2);
              const hits = mergeFindings(
                health.findings,
                emptyBoxes.map((row) => ({ id: 'empty_number_box', detail: row.selector })),
                consoleFindings(errs),
              );
              if (!targetIds.size) return hits.length > 0;
              return hits.some((h) => targetIds.has(h.id));
            } finally {
              await p2.close();
            }
          };
          finding.minimizedSteps = await minimizeSteps(steps, stillBroken);
        },
      });
      explorerTrace = explorerResult.trace;
      findings.push(...explorerResult.findings);
      await page.close();
    } else if (!seedsOnly) {
      const starter = regressionSeeds[0];
      const { page } = await openAgentPage(browser, {
        width: 1280,
        height: 800,
        baseUrl: BASE_URL,
        userId: starter.userId,
        assembly: starter.seedDoc(),
        parts: starter.seedParts(),
      });
      const probe = await runDeterministicProbe({ page, agentCall, budget });
      explorerTrace = probe.trace;
      await page.close();
    }
  }

  await browser.close();
} finally {
  stop();
}

const finishedAt = new Date().toISOString();
const ok = seedReports.every((r) => r.ok) && findings.length === 0;

const payload = {
  v: 1,
  ok,
  startedAt,
  finishedAt,
  durationMs: Date.now() - t0,
  baseUrl: BASE_URL,
  seeds: seedReports,
  findings,
  explorerTrace,
  budget: budget.snapshot(),
  llm: { model: llmCfg.model, configured: llm.configured },
};

const { jsonPath, mdPath } = writeBugHunterReport(outDir, payload);
writeBugHunterReport(join(outDir, 'latest'), payload);

console.log(`bug-hunter: ${ok ? 'PASS' : 'FINDINGS'} — seeds ${seedReports.filter((r) => r.ok).length}/${seedReports.length}`);
console.log(`  report ${jsonPath}`);
console.log(`  summary ${mdPath}`);

process.exit(ok ? 0 : 1);
